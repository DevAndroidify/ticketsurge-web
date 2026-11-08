import type { Backend, Outcome, Session } from '../backend';
import type { SaleEvent, Seat, SeatStatus } from '../types';
import { partySize, pickSeats } from './seat-picker';

export type BotPhase =
  | 'registering'
  | 'queued'
  | 'holding'
  | 'booking'
  | 'paying'
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'lost'
  | 'abandoned'
  | 'failed';

export const PHASES: readonly BotPhase[] = [
  'registering',
  'queued',
  'holding',
  'booking',
  'paying',
  'confirmed',
  'cancelled',
  'expired',
  'lost',
  'abandoned',
  'failed',
];

export interface SwarmOptions {
  bots: number;
  /** Share of bots that hold seats and then walk away. */
  abandonRate: number;
  /** Share of bookings sent twice with the same Idempotency-Key, as a flaky network would. */
  retryRate: number;
  maxSeatsPerBot: number;
  /** Parallel sign-ups; each one costs the API a scrypt hash. */
  registerConcurrency: number;
}

export const DEFAULT_SWARM: SwarmOptions = {
  bots: 300,
  abandonRate: 0.1,
  retryRate: 0.15,
  maxSeatsPerBot: 4,
  registerConcurrency: 12,
};

export type ActivityKind = 'info' | 'success' | 'warn' | 'error';

export interface Activity {
  id: number;
  at: number;
  bot: string;
  kind: ActivityKind;
  text: string;
}

export interface SwarmSnapshot {
  running: boolean;
  startedAt: number;
  phases: Record<BotPhase, number>;
  requests: number;
  /** 409s: a seat someone else got first. Every one is a double sale that did not happen. */
  conflicts: number;
  rateLimited: number;
  unavailable: number;
  /** Duplicate POST /bookings that came back with the same booking. */
  idempotentReplays: number;
  /** Duplicates that created a second booking. Must stay zero. */
  replayMismatches: number;
  seatsConfirmed: number;
  /** Seats that two bots both hold a confirmed booking for. Must stay zero. */
  doubleSold: number;
  activity: Activity[];
}

/** The seat map the bots pick from: shared, kept fresh by the WebSocket, updated optimistically. */
export interface SeatView {
  seats(): readonly Seat[];
  mark(seatIds: readonly string[], status: SeatStatus): void;
}

const MAX_ACTIVITY = 60;

/**
 * A crowd of virtual buyers. Each bot signs up, joins the queue, waits to be admitted, holds
 * seats (retrying with other seats when it loses a race), books with an Idempotency-Key, and
 * polls until payment confirms or cancels the booking.
 */
export class Swarm {
  private readonly phase = new Map<string, BotPhase>();
  private readonly confirmedBy = new Map<string, string>();
  private activity: Activity[] = [];
  private activitySeq = 0;
  private stopped = false;
  private counters = {
    requests: 0,
    conflicts: 0,
    rateLimited: 0,
    unavailable: 0,
    idempotentReplays: 0,
    replayMismatches: 0,
    doubleSold: 0,
  };
  private startedAt = 0;
  private running = false;

  constructor(
    private readonly backend: Backend,
    private readonly event: SaleEvent,
    private readonly view: SeatView,
    private readonly options: SwarmOptions = DEFAULT_SWARM,
    private readonly random: () => number = Math.random,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  /** Runs every bot to completion (or until stop()). */
  async run(): Promise<void> {
    this.running = true;
    this.startedAt = Date.now();
    const labels = Array.from(
      { length: this.options.bots },
      (_, i) => `bot-${String(i + 1).padStart(3, '0')}`,
    );
    for (const label of labels) this.phase.set(label, 'registering');
    this.log('swarm', 'info', `${labels.length} buyers arrive for ${this.event.name}`);

    const signUps = limiter(this.options.registerConcurrency);
    await Promise.all(labels.map((label) => this.runBot(label, signUps)));
    this.running = false;
    if (!this.stopped) this.log('swarm', 'info', 'Every buyer has finished');
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
  }

  snapshot(): SwarmSnapshot {
    const phases = Object.fromEntries(PHASES.map((p) => [p, 0])) as Record<BotPhase, number>;
    for (const p of this.phase.values()) phases[p]++;
    return {
      running: this.running,
      startedAt: this.startedAt,
      phases,
      ...this.counters,
      seatsConfirmed: this.confirmedBy.size,
      activity: this.activity,
    };
  }

  private async runBot(label: string, signUps: <T>(task: () => Promise<T>) => Promise<T>) {
    const created = await signUps(() => this.call(() => this.backend.createUser(label)));
    if (!created.ok) {
      this.finish(label, 'failed', `sign-up failed: ${created.code}`);
      return;
    }
    const session = created.session;

    if (!(await this.waitForAdmission(label, session))) return;
    if (this.isStopped()) return;

    const hold = await this.holdSeats(label, session);
    if (!hold) return;

    if (this.random() < this.options.abandonRate) {
      // Some walk away politely, the rest just close the tab and let the hold expire.
      if (this.random() < 0.5)
        await this.call(() => this.backend.releaseHold(session, hold.holdId));
      this.finish(label, 'abandoned', `walked away from ${hold.seatIds.length} seat(s)`);
      return;
    }

    await this.sleep(400 + this.random() * 1600);
    if (this.isStopped()) return;
    this.phase.set(label, 'booking');
    const bookingId = await this.book(label, session, hold.holdId);
    if (!bookingId) return;

    this.phase.set(label, 'paying');
    await this.awaitPayment(label, session, bookingId, hold.seatIds);
  }

  private async waitForAdmission(label: string, session: Session): Promise<boolean> {
    this.phase.set(label, 'queued');
    let status = await this.retrying(() => this.backend.joinQueue(session, this.event.id));
    while (!this.stopped) {
      if (!status.ok) {
        if (status.http === 404) {
          // Admission expired or the queue entry was lost (e.g. Redis restarted): rejoin.
          status = await this.retrying(() => this.backend.joinQueue(session, this.event.id));
          continue;
        }
        this.finish(label, 'failed', `queue error: ${status.code}`);
        return false;
      }
      if (status.admitted) {
        this.log(label, 'info', 'admitted from the waiting room');
        return true;
      }
      await this.sleep(700 + this.random() * 800);
      status = await this.retrying(() => this.backend.queueStatus(session, this.event.id));
    }
    return false;
  }

  private async holdSeats(label: string, session: Session) {
    this.phase.set(label, 'holding');
    const wanted = partySize(this.random, this.options.maxSeatsPerBot);
    for (let attempt = 1; attempt <= 4 && !this.stopped; attempt++) {
      const seatIds = pickSeats(this.view.seats(), wanted, this.random);
      if (seatIds.length === 0) {
        this.finish(label, 'lost', 'sold out before getting a seat');
        return undefined;
      }
      const result = await this.retrying(() => this.backend.hold(session, this.event.id, seatIds));
      if (result.ok) {
        this.view.mark(seatIds, 'held');
        this.log(label, 'info', `held ${seatIds.length} seat(s)`);
        return { holdId: result.holdId, seatIds };
      }
      if (result.http === 409) {
        this.counters.conflicts++;
        // Someone else got there first; their seats are taken, so stop picking them.
        this.view.mark(seatIds, 'held');
        this.log(label, 'warn', `409 · lost the race for ${seatIds.length} seat(s), retrying`);
        await this.sleep(100 + this.random() * 400);
        continue;
      }
      if (result.http === 403) {
        if (!(await this.waitForAdmission(label, session))) return undefined;
        this.phase.set(label, 'holding');
        continue;
      }
      this.finish(label, 'failed', `hold failed: ${result.code}`);
      return undefined;
    }
    if (!this.stopped) this.finish(label, 'lost', 'gave up after 4 lost races');
    return undefined;
  }

  private async book(label: string, session: Session, holdId: string) {
    const key = crypto.randomUUID();
    const send = () => this.retrying(() => this.backend.book(session, holdId, key));
    // A flaky network: the same request, with the same key, sent twice at once.
    const duplicate = this.random() < this.options.retryRate;
    const [first, second] = await Promise.all([send(), duplicate ? send() : undefined]);

    if (second) {
      if (first.ok && second.ok && first.bookingId === second.bookingId) {
        this.counters.idempotentReplays++;
        this.log(label, 'info', 'sent the booking twice · same Idempotency-Key, one booking');
      } else if (first.ok && second.ok) {
        this.counters.replayMismatches++;
        this.log(label, 'error', 'duplicate request created a second booking');
      }
    }
    const result = first.ok ? first : second?.ok ? second : first;
    if (!result.ok) {
      this.finish(label, 'lost', `booking rejected: ${result.http} ${result.code}`);
      return undefined;
    }
    this.log(label, 'info', '202 · booking accepted, waiting for payment');
    return result.bookingId;
  }

  private async awaitPayment(label: string, session: Session, id: string, seatIds: string[]) {
    const deadline = Date.now() + 10 * 60_000;
    while (!this.stopped && Date.now() < deadline) {
      await this.sleep(1000 + this.random() * 800);
      const result = await this.retrying(() => this.backend.booking(session, id));
      if (!result.ok || result.status === 'PENDING_PAYMENT') continue;

      if (result.status === 'CONFIRMED') {
        for (const seatId of seatIds) {
          if (this.confirmedBy.has(seatId)) this.counters.doubleSold++;
          this.confirmedBy.set(seatId, label);
        }
        this.view.mark(seatIds, 'sold');
        this.finish(label, 'confirmed', `confirmed · ${seatIds.length} ticket(s)`);
        return;
      }
      this.view.mark(seatIds, 'available');
      if (result.status === 'CANCELLED') {
        this.finish(label, 'cancelled', 'payment failed · booking cancelled, seats released');
      } else {
        this.finish(label, 'expired', 'payment too slow · booking expired');
      }
      return;
    }
  }

  /** A method, not a field read, so TypeScript does not assume it is unchanged across awaits. */
  private isStopped(): boolean {
    return this.stopped;
  }

  /** Waits out 429 (Retry-After) and 503 (Redis down) responses instead of giving up. */
  private async retrying<T extends object>(send: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
    for (;;) {
      const result = await this.call(send);
      if (result.ok || this.stopped) return result;
      if (result.http === 429) {
        this.counters.rateLimited++;
        await this.sleep(result.retryAfterMs ?? 1000);
      } else if (result.http === 503 || result.http === 0) {
        this.counters.unavailable++;
        await this.sleep(1000 + this.random() * 1000);
      } else {
        return result;
      }
    }
  }

  private async call<T>(send: () => Promise<T>): Promise<T> {
    this.counters.requests++;
    return send();
  }

  private finish(label: string, phase: BotPhase, text: string) {
    this.phase.set(label, phase);
    const kind: ActivityKind =
      phase === 'confirmed' ? 'success' : phase === 'failed' ? 'error' : 'warn';
    this.log(label, kind, text);
  }

  private log(bot: string, kind: ActivityKind, text: string) {
    const item = { id: ++this.activitySeq, at: Date.now(), bot, kind, text };
    this.activity = [item, ...this.activity].slice(0, MAX_ACTIVITY);
  }
}

/** Runs at most `max` tasks at once. */
export function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    while (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
