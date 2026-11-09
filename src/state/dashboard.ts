import type { Backend, SaleOptions, Session, SocketState } from '../lib/backend';
import { DEFAULT_SWARM, Swarm, type SwarmOptions, type SwarmSnapshot } from '../lib/bots/swarm';
import { BuyerJourney, FINAL_STEPS, type JourneySnapshot } from '../lib/buyer/journey';
import type { ComponentStatus, MetricsSnapshot, SaleEvent, Seat, SeatStatus } from '../lib/types';

/** `open` means an event is ready for the visitor to buy from, with no crowd sent in yet. */
export type SalePhase = 'idle' | 'preparing' | 'open' | 'running' | 'finished';

/** The event a visitor gets when they start buying before anyone launched a sale. */
const BUYER_LAYOUT: SaleOptions = { sections: 4, rows: 6, seatsPerRow: 16 };
const SAMPLE_MS = 250;

export interface SeatCell extends Seat {
  /** When the status last changed, for the flash animation. */
  changedAt: number;
}

export interface DashboardState {
  components: ComponentStatus[];
  metrics: MetricsSnapshot | undefined;
  /** Oldest first, one sample per poll, about two minutes long. */
  history: MetricsSnapshot[];
  /** Requests per second the bots are sending, measured in the browser. */
  clientRps: number;
  sale: {
    phase: SalePhase;
    event?: SaleEvent;
    seats: SeatCell[];
    socket: SocketState;
    degraded: boolean;
    swarm?: SwarmSnapshot;
    /** New buyers per second joining the running sale. */
    arrivalRate: number;
    error?: string;
  };
  /** The visitor's own purchase, if they started one. */
  buyer?: JourneySnapshot;
}

const HISTORY = 90;

/**
 * Owns all polling and the running sale, and hands React an immutable snapshot through
 * subscribe/getSnapshot (useSyncExternalStore). Emits are batched to about 5 per second.
 */
export class DashboardController {
  private state: DashboardState = {
    components: [],
    metrics: undefined,
    history: [],
    clientRps: 0,
    sale: { phase: 'idle', seats: [], socket: 'closed', degraded: false, arrivalRate: 0 },
  };
  private readonly listeners = new Set<() => void>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private seatIndex = new Map<string, SeatCell>();
  private swarm: Swarm | undefined;
  private journey: BuyerJourney | undefined;
  private arrivalCredit = 0;
  private unsubscribe: (() => void) | undefined;
  private emitQueued = false;
  private lastRequests = { at: 0, count: 0 };
  private disposed = false;

  constructor(readonly backend: Backend) {
    const fast = backend.mode === 'simulated' ? 1000 : 2000;
    void this.pollComponents();
    void this.pollMetrics();
    this.timers.push(setInterval(() => void this.pollComponents(), 2000));
    this.timers.push(setInterval(() => void this.pollMetrics(), fast));
    this.timers.push(
      setInterval(() => {
        this.sampleSwarm();
        this.journey?.tick();
      }, SAMPLE_MS),
    );
    // Redis Pub/Sub keeps no history, so the live seat map is also reloaded now and then.
    this.timers.push(setInterval(() => void this.reloadSeats(), 5000));
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.state;

  async launch(options: SaleOptions, swarmOptions: SwarmOptions = DEFAULT_SWARM): Promise<void> {
    if (this.state.sale.phase === 'preparing' || this.state.sale.phase === 'running') return;
    // The crowd joins the event the visitor is already buying from, instead of replacing it.
    const current = this.reusesEvent() ? this.state.sale.event : undefined;
    this.stopSale();
    if (!current) this.endJourney();
    this.patchSale({
      phase: 'preparing',
      error: undefined,
      swarm: undefined,
      ...(current ? {} : { seats: [] }),
    });
    try {
      const event = current ?? (await this.openEvent(options));
      const swarm = new Swarm(this.backend, event, this.seatView(), swarmOptions);
      this.swarm = swarm;
      this.patchSale({ phase: 'running' });
      await swarm.run();
      if (this.swarm === swarm) {
        this.patchSale({ phase: 'finished', swarm: swarm.snapshot(), arrivalRate: 0 });
      }
    } catch (error) {
      this.patchSale({
        phase: 'idle',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** True when launching a crowd would join the current event rather than create a new one. */
  reusesEvent(): boolean {
    const { phase, event } = this.state.sale;
    return event !== undefined && (phase === 'open' || this.journeyActive());
  }

  /** A burst of new buyers joins the running sale. */
  addTraffic(count: number): void {
    if (this.state.sale.phase === 'running') this.swarm?.addBots(count);
  }

  /** A steady stream of new buyers per second, for as long as the sale runs. */
  setArrivalRate(arrivalRate: number): void {
    this.arrivalCredit = 0;
    this.patchSale({ arrivalRate });
  }

  // ---------- The visitor's own purchase ----------

  /** Starts a purchase, opening an event first if no sale exists yet. */
  async startBuying(): Promise<void> {
    if (this.journeyActive()) return;
    const { phase } = this.state.sale;
    if (phase === 'preparing') return;
    this.endJourney();

    let event = this.state.sale.event;
    if (!event) {
      this.patchSale({ phase: 'preparing', error: undefined });
      try {
        event = await this.openEvent(BUYER_LAYOUT);
        this.patchSale({ phase: 'open' });
      } catch (error) {
        this.patchSale({
          phase: 'idle',
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    const journey = new BuyerJourney(this.backend, event, this.seatView(), () => {
      if (this.journey === journey) this.set({ buyer: journey.snapshot() });
    });
    this.journey = journey;
    await journey.start();
  }

  toggleSeat(seatId: string): void {
    this.journey?.toggleSeat(seatId);
  }

  holdSeats(): void {
    void this.journey?.holdSelected();
  }

  pay(): void {
    void this.journey?.pay();
  }

  releaseSeats(): void {
    void this.journey?.release();
  }

  /** Stops the purchase and clears it from the screen. */
  endJourney(): void {
    this.journey?.stop();
    this.journey = undefined;
    this.set({ buyer: undefined });
  }

  private journeyActive(): boolean {
    const step = this.journey?.snapshot().step;
    return step !== undefined && !FINAL_STEPS.includes(step);
  }

  private async openEvent(options: SaleOptions): Promise<SaleEvent> {
    const event = await this.backend.prepareSale(options);
    const observer = await this.backend.createUser(`observer-${crypto.randomUUID().slice(0, 8)}`);
    if (!observer.ok) throw new Error(`Could not sign in the dashboard: ${observer.message}`);
    this.patchSale({ event });
    await this.reloadSeats(event.id);
    this.watchSeats(observer.session, event.id);
    return event;
  }

  /** Polls right away, e.g. after a component was stopped in simulated mode. */
  refresh(): void {
    void this.pollComponents();
    void this.pollMetrics();
  }

  stopSale(): void {
    const swarm = this.swarm;
    this.swarm = undefined;
    swarm?.stop();
    if (swarm && this.state.sale.phase === 'running') {
      this.patchSale({ phase: 'finished', swarm: swarm.snapshot(), arrivalRate: 0 });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopSale();
    this.journey?.stop();
    this.unsubscribe?.();
    for (const timer of this.timers) clearInterval(timer);
    this.backend.dispose();
    this.listeners.clear();
  }

  // ---------- Polling ----------

  private async pollComponents() {
    const components = await this.backend.components().catch(() => this.state.components);
    this.set({ components });
  }

  private async pollMetrics() {
    const metrics = await this.backend.metrics();
    const history = [...this.state.history, metrics].slice(-HISTORY);
    this.set({ metrics, history });
  }

  private sampleSwarm() {
    const swarm = this.swarm;
    if (!swarm) {
      if (this.state.clientRps !== 0) this.set({ clientRps: 0 });
      return;
    }
    if (this.state.sale.arrivalRate > 0) {
      this.arrivalCredit += (this.state.sale.arrivalRate * SAMPLE_MS) / 1000;
      const whole = Math.floor(this.arrivalCredit);
      this.arrivalCredit -= whole;
      if (whole > 0) this.addTraffic(whole);
    }
    const snapshot = swarm.snapshot();
    const now = Date.now();
    const elapsed = (now - this.lastRequests.at) / 1000;
    if (elapsed >= 1) {
      const rps =
        this.lastRequests.at === 0 ? 0 : (snapshot.requests - this.lastRequests.count) / elapsed;
      this.lastRequests = { at: now, count: snapshot.requests };
      this.set({ clientRps: Math.max(0, rps) });
    }
    this.patchSale({ swarm: snapshot });
  }

  // ---------- Seats ----------

  private async reloadSeats(eventId = this.state.sale.event?.id) {
    if (!eventId) return;
    try {
      const map = await this.backend.seats(eventId);
      const now = Date.now();
      const next = new Map<string, SeatCell>();
      for (const seat of map.seats) {
        const previous = this.seatIndex.get(seat.id);
        const changed = previous !== undefined && previous.status !== seat.status;
        next.set(seat.id, { ...seat, changedAt: changed ? now : (previous?.changedAt ?? 0) });
      }
      this.seatIndex = next;
      this.patchSale({ seats: [...next.values()], degraded: map.degraded });
    } catch {
      // Keep the last good map; the next reload or a WebSocket update will catch up.
    }
  }

  private watchSeats(session: Session, eventId: string) {
    this.unsubscribe?.();
    let wasOpen = false;
    this.unsubscribe = this.backend.subscribeSeats(
      session,
      eventId,
      ({ seatIds, status }) => {
        this.markSeats(seatIds, status);
      },
      (socket) => {
        this.patchSale({ socket });
        // Anything published while the socket was down is gone: reload after a reconnect.
        if (socket === 'open' && wasOpen) void this.reloadSeats(eventId);
        if (socket === 'open') wasOpen = true;
      },
    );
  }

  private markSeats(seatIds: readonly string[], status: SeatStatus) {
    const now = Date.now();
    let changed = false;
    for (const id of seatIds) {
      const seat = this.seatIndex.get(id);
      if (!seat || seat.status === status) continue;
      // A sold seat never goes back; a late "held" from a stale view must not hide that.
      if (seat.status === 'sold') continue;
      this.seatIndex.set(id, { ...seat, status, changedAt: now });
      changed = true;
    }
    if (changed) this.patchSale({ seats: [...this.seatIndex.values()] });
  }

  private seatView() {
    return {
      seats: () => this.state.sale.seats,
      mark: (seatIds: readonly string[], status: SeatStatus) => {
        this.markSeats(seatIds, status);
      },
    };
  }

  // ---------- State plumbing ----------

  private patchSale(patch: Partial<DashboardState['sale']>) {
    this.set({ sale: { ...this.state.sale, ...patch } });
  }

  private set(patch: Partial<DashboardState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    if (this.emitQueued) return;
    this.emitQueued = true;
    setTimeout(() => {
      this.emitQueued = false;
      for (const listener of this.listeners) listener();
    }, 200);
  }
}
