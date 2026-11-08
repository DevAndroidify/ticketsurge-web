import type { Backend, SaleOptions, Session, SocketState } from '../lib/backend';
import { DEFAULT_SWARM, Swarm, type SwarmOptions, type SwarmSnapshot } from '../lib/bots/swarm';
import type { ComponentStatus, MetricsSnapshot, SaleEvent, Seat, SeatStatus } from '../lib/types';

export type SalePhase = 'idle' | 'preparing' | 'running' | 'finished';

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
    error?: string;
  };
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
    sale: { phase: 'idle', seats: [], socket: 'closed', degraded: false },
  };
  private readonly listeners = new Set<() => void>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private seatIndex = new Map<string, SeatCell>();
  private swarm: Swarm | undefined;
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
      }, 250),
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
    this.stopSale();
    this.patchSale({ phase: 'preparing', error: undefined, swarm: undefined, seats: [] });
    try {
      const event = await this.backend.prepareSale(options);
      const observer = await this.backend.createUser('observer');
      if (!observer.ok) throw new Error(`Could not sign in the dashboard: ${observer.message}`);

      this.patchSale({ event });
      await this.reloadSeats(event.id);
      this.watchSeats(observer.session, event.id);

      const swarm = new Swarm(this.backend, event, this.seatView(), swarmOptions);
      this.swarm = swarm;
      this.patchSale({ phase: 'running' });
      await swarm.run();
      if (this.swarm === swarm) this.patchSale({ phase: 'finished', swarm: swarm.snapshot() });
    } catch (error) {
      this.patchSale({
        phase: 'idle',
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
      this.patchSale({ phase: 'finished', swarm: swarm.snapshot() });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopSale();
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
