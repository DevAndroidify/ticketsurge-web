import type { Backend, Outcome, QueueStatus, Session } from '../backend';
import type { SeatView } from '../bots/swarm';
import type { SaleEvent } from '../types';

export type JourneyStep =
  | 'idle'
  | 'signing-in'
  | 'queued'
  | 'picking'
  | 'holding'
  | 'held'
  | 'booking'
  | 'paying'
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'hold-lost'
  | 'released'
  | 'error';

/** Steps the purchase cannot continue from; the visitor can only start again. */
export const FINAL_STEPS: readonly JourneyStep[] = [
  'confirmed',
  'cancelled',
  'expired',
  'hold-lost',
  'released',
  'error',
];

/** A route through the architecture, drawn on the flow diagram. */
export type TraceId =
  | 'signup'
  | 'queue'
  | 'admitted'
  | 'hold'
  | 'hold-rejected'
  | 'release'
  | 'book'
  | 'confirmed'
  | 'cancelled'
  | 'expired';

export type JourneyTech = 'http' | 'redis' | 'pg' | 'kafka' | 'ws';
export type JourneyTone = 'info' | 'good' | 'warn' | 'bad';

export interface JourneyEntry {
  id: number;
  at: number;
  tech: JourneyTech;
  tone: JourneyTone;
  title: string;
  detail: string;
  /** The HTTP status and measured time of the request behind this entry, when there was one. */
  http?: number;
  ms?: number;
  trace?: TraceId;
}

export interface JourneySnapshot {
  step: JourneyStep;
  /** Place in the waiting room while queued. */
  position?: number;
  /** Seats chosen on the map, not yet requested. */
  selected: readonly string[];
  /** Seats this visitor holds or has booked. */
  seats: readonly string[];
  holdExpiresAt?: number;
  bookingId?: string;
  /** Why the journey is waiting or why it ended. */
  message?: string;
  /** Newest first. */
  log: readonly JourneyEntry[];
}

export const MAX_SEATS = 4;
const MAX_LOG = 30;
const QUEUE_POLL_MS = 700;
const BOOKING_POLL_MS = 800;
const OUTAGE_RETRY_MS = 1500;

export interface JourneyOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

// Ids stay unique across journeys, so the flow diagram never mistakes a new entry for an old one.
let entryId = 0;

/**
 * One visitor buying by hand, through the same Backend calls as the bots. Each method is one
 * decision the visitor makes; everything between decisions (waiting in the queue, polling for
 * the payment result) runs by itself and reports through `onChange`.
 */
export class BuyerJourney {
  private state: JourneySnapshot = { step: 'idle', selected: [], seats: [], log: [] };
  private session: Session | undefined;
  private holdId: string | undefined;
  private stopped = false;
  private lastNote: string | undefined;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly backend: Backend,
    private readonly event: SaleEvent,
    private readonly view: SeatView,
    private readonly onChange: () => void = () => undefined,
    options: JourneyOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  snapshot(): JourneySnapshot {
    return this.state;
  }

  /** Signs up and joins the waiting room; resolves once admitted or stopped. */
  async start(): Promise<void> {
    if (this.state.step !== 'idle') return;
    this.patch({ step: 'signing-in' });
    // The label becomes part of an email address, which must be new for every journey.
    const label = `you-${crypto.randomUUID().slice(0, 8)}`;
    const { result, ms } = await this.call(() => this.backend.createUser(label));
    if (this.isStopped()) return;
    if (!result.ok) {
      this.fail(`Sign-up failed: ${result.message}`);
      return;
    }
    this.session = result.session;
    this.log({
      tech: 'pg',
      tone: 'info',
      title: 'Account created',
      detail: 'The password is hashed with scrypt and the user is stored in PostgreSQL.',
      http: result.http,
      ms,
      trace: 'signup',
    });
    await this.enterQueue(result.session);
  }

  toggleSeat(seatId: string): void {
    if (this.state.step !== 'picking') return;
    const { selected } = this.state;
    if (selected.includes(seatId)) {
      this.patch({ selected: selected.filter((id) => id !== seatId) });
      return;
    }
    if (selected.length >= MAX_SEATS) return;
    const seat = this.view.seats().find((s) => s.id === seatId);
    if (seat?.status !== 'available') return;
    this.patch({ selected: [...selected, seatId] });
  }

  /** Asks Redis for every selected seat; all of them are held or none are. */
  async holdSelected(): Promise<void> {
    const { step, selected } = this.state;
    const session = this.session;
    if (step !== 'picking' || !session || selected.length === 0) return;
    const seatIds = [...selected];
    this.patch({ step: 'holding' });

    const { result, ms } = await this.call(() =>
      this.backend.hold(session, this.event.id, seatIds),
    );
    if (this.isStopped()) return;

    if (result.ok) {
      this.holdId = result.holdId;
      this.view.mark(seatIds, 'held');
      this.patch({
        step: 'held',
        selected: [],
        seats: seatIds,
        holdExpiresAt: Date.parse(result.expiresAt),
      });
      this.log({
        tech: 'redis',
        tone: 'good',
        title: `Held ${seatIds.length} seat${seatIds.length === 1 ? '' : 's'}`,
        detail: 'One atomic Lua script checked every seat and took them all together.',
        http: result.http,
        ms,
        trace: 'hold',
      });
      return;
    }
    if (result.http === 409) {
      this.patch({
        step: 'picking',
        selected: [],
        message: 'Another buyer got there first. Pick different seats.',
      });
      this.log({
        tech: 'redis',
        tone: 'bad',
        title: 'Beaten to it',
        detail: 'A seat was already taken, so the Lua script changed nothing at all.',
        http: result.http,
        ms,
        trace: 'hold-rejected',
      });
      return;
    }
    if (result.http === 403) {
      // Admission lasts a few minutes. Back to the queue, keeping nothing held.
      this.log({
        tech: 'redis',
        tone: 'warn',
        title: 'Admission expired',
        detail: 'The admission marker has a TTL, so you have to queue again.',
        http: result.http,
        ms,
      });
      await this.enterQueue(session);
      return;
    }
    this.fail(`Could not hold seats: ${result.message}`);
  }

  /** Creates the booking. The payment that follows is simulated by payment-service. */
  async pay(): Promise<void> {
    const { step } = this.state;
    const session = this.session;
    const holdId = this.holdId;
    if (step !== 'held' || !session || !holdId) return;
    this.patch({ step: 'booking' });

    // One key for the whole attempt: if a retry repeats the request, it returns the same booking.
    const key = crypto.randomUUID();
    const { result, ms } = await this.call(() => this.backend.book(session, holdId, key));
    if (this.isStopped()) return;

    if (!result.ok) {
      if (result.http === 409) {
        this.patch({
          step: 'hold-lost',
          message: 'The hold ended before the booking was created.',
        });
        this.log({
          tech: 'pg',
          tone: 'bad',
          title: 'Booking refused',
          detail: 'The hold was gone, so nothing was written to PostgreSQL.',
          http: result.http,
          ms,
          trace: 'hold-rejected',
        });
        return;
      }
      this.fail(`Could not book: ${result.message}`);
      return;
    }

    this.patch({ step: 'paying', bookingId: result.bookingId, holdExpiresAt: undefined });
    this.log({
      tech: 'pg',
      tone: 'info',
      title: 'Booking accepted',
      detail: 'One transaction saved the booking, its seats, and a Kafka message in the outbox.',
      http: result.http,
      ms,
      trace: 'book',
    });
    await this.awaitPayment(session, result.bookingId);
  }

  /** Gives the seats back on purpose. */
  async release(): Promise<void> {
    const { step, seats } = this.state;
    const session = this.session;
    const holdId = this.holdId;
    if (step !== 'held' || !session || !holdId) return;
    // Set before the request, so a second click cannot release twice. If the request fails the
    // hold still ends by itself when its TTL passes.
    this.patch({ step: 'released', message: 'You let the seats go.', holdExpiresAt: undefined });
    this.view.mark(seats, 'available');
    const { result, ms } = await this.call(() => this.backend.releaseHold(session, holdId));
    if (result.ok) {
      this.log({
        tech: 'redis',
        tone: 'info',
        title: 'Seats released',
        detail: 'Redis deleted the seats and told every connected browser over Pub/Sub.',
        http: result.http,
        ms,
        trace: 'release',
      });
    }
  }

  /** Called on a timer: a hold that runs out ends the journey, as its Redis TTL does. */
  tick(): void {
    const { step, holdExpiresAt, seats } = this.state;
    if (step !== 'held' || holdExpiresAt === undefined || this.now() < holdExpiresAt) return;
    this.view.mark(seats, 'available');
    this.patch({
      step: 'hold-lost',
      message: 'The hold ran out, so the seats went back on sale.',
      holdExpiresAt: undefined,
    });
    this.log({
      tech: 'redis',
      tone: 'warn',
      title: 'Hold expired',
      detail: 'Nobody had to clean up: the seat keys simply reached their TTL in Redis.',
    });
  }

  stop(): void {
    this.stopped = true;
  }

  private async enterQueue(session: Session) {
    this.patch({ step: 'queued', position: undefined });
    const joined = await this.call(() => this.backend.joinQueue(session, this.event.id));
    if (this.isStopped()) return;
    if (joined.result.ok && !joined.result.admitted) {
      this.log({
        tech: 'redis',
        tone: 'info',
        title: `In the waiting room at #${joined.result.position}`,
        detail: 'A Lua script gave you the next place in a Redis sorted set.',
        http: joined.result.http,
        ms: joined.ms,
        trace: 'queue',
      });
    }

    let status: Outcome<QueueStatus> = joined.result;
    while (!this.isStopped()) {
      if (!status.ok) {
        if (status.http !== 404) {
          this.fail(`Queue error: ${status.message}`);
          return;
        }
        // The place was lost, e.g. Redis restarted and queue places are not recovered.
        status = (await this.call(() => this.backend.joinQueue(session, this.event.id))).result;
        continue;
      }
      if (status.admitted) {
        this.patch({ step: 'picking', position: undefined });
        this.log({
          tech: 'redis',
          tone: 'good',
          title: 'You are in',
          detail: 'The admission worker let the next batch through. Pick up to four seats.',
          http: status.http,
          trace: 'admitted',
        });
        return;
      }
      this.patch({ position: status.position });
      await this.sleep(QUEUE_POLL_MS);
      if (this.isStopped()) return;
      status = (await this.call(() => this.backend.queueStatus(session, this.event.id))).result;
    }
  }

  private async awaitPayment(session: Session, bookingId: string) {
    while (!this.isStopped()) {
      await this.sleep(BOOKING_POLL_MS);
      if (this.isStopped()) return;
      const { result } = await this.call(() => this.backend.booking(session, bookingId));
      if (this.isStopped()) return;
      if (!result.ok) {
        this.fail(`Could not read the booking: ${result.message}`);
        return;
      }
      if (result.status === 'PENDING_PAYMENT') continue;

      const { seats } = this.state;
      if (result.status === 'CONFIRMED') {
        this.view.mark(seats, 'sold');
        this.patch({ step: 'confirmed', message: undefined });
        this.log({
          tech: 'kafka',
          tone: 'good',
          title: 'Payment succeeded, booking confirmed',
          detail:
            'The saga confirmed it, then Kafka carried it to tickets, seat sync and analytics.',
          trace: 'confirmed',
        });
      } else if (result.status === 'CANCELLED') {
        this.view.mark(seats, 'available');
        this.patch({ step: 'cancelled', message: 'The simulated payment was declined.' });
        this.log({
          tech: 'kafka',
          tone: 'bad',
          title: 'Payment failed, booking cancelled',
          detail: 'The saga cancelled it and released the seats, so someone else can buy them.',
          trace: 'cancelled',
        });
      } else {
        this.view.mark(seats, 'available');
        this.patch({ step: 'expired', message: 'No payment result arrived before the deadline.' });
        this.log({
          tech: 'pg',
          tone: 'warn',
          title: 'Booking expired',
          detail: 'The sweeper closed it at the deadline. A late payment would be refunded.',
          trace: 'expired',
        });
      }
      return;
    }
  }

  /** Waits out 429s and outages instead of failing, and says so while it does. */
  private async call<T extends object>(
    send: () => Promise<Outcome<T>>,
  ): Promise<{ result: Outcome<T>; ms: number }> {
    for (;;) {
      const started = this.now();
      const result = await send();
      const ms = this.now() - started;
      if (result.ok) {
        if (this.lastNote) {
          this.lastNote = undefined;
          this.patch({ message: undefined });
        }
        return { result, ms };
      }
      if (this.isStopped()) return { result, ms };

      if (result.http === 429) {
        this.note('Rate limited (429). Waiting for the window to reset.', result.http);
        await this.sleep(result.retryAfterMs ?? 1000);
      } else if (result.http === 503 || result.http === 0) {
        this.note('The backend is unavailable. Retrying until it comes back.', result.http);
        await this.sleep(OUTAGE_RETRY_MS);
      } else {
        return { result, ms };
      }
    }
  }

  /** Reports a temporary problem once, not once per retry. */
  private note(message: string, http: number) {
    if (this.lastNote === message) return;
    this.lastNote = message;
    this.patch({ message });
    this.log({ tech: 'http', tone: 'warn', title: 'Waiting', detail: message, http });
  }

  private fail(message: string) {
    this.patch({ step: 'error', message });
    this.log({ tech: 'http', tone: 'bad', title: 'Something went wrong', detail: message });
  }

  /** A method, not a field read, so TypeScript does not assume it is unchanged across awaits. */
  private isStopped(): boolean {
    return this.stopped;
  }

  private log(entry: Omit<JourneyEntry, 'id' | 'at'>) {
    const item = { ...entry, id: ++entryId, at: this.now() };
    this.patch({ log: [item, ...this.state.log].slice(0, MAX_LOG) });
  }

  private patch(patch: Partial<JourneySnapshot>) {
    if (this.stopped) return;
    this.state = { ...this.state, ...patch };
    this.onChange();
  }
}
