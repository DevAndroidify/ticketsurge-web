import {
  ROW_LABELS,
  SECTION_NAMES,
  SECTION_PRICES_MINOR,
  type Backend,
  type Chaos,
  type Outcome,
  type QueueStatus,
  type SaleOptions,
  type SeatsUpdated,
  type Session,
  type SocketState,
} from '../backend';
import type {
  BookingStatus,
  ComponentStatus,
  MetricsSnapshot,
  SaleEvent,
  Seat,
  SeatMap,
  SeatStatus,
} from '../types';
import { emptySnapshot } from '../types';

/**
 * A small in-browser model of the TicketSurge backend, so the dashboard works with nothing running.
 * It follows the same rules as the real services: holds are all-or-nothing, a seat can have only
 * one active booking, bookings go through an outbox, and Kafka consumer groups process messages
 * at a limited rate, so lag builds up and drains. Timings are shorter than the backend's defaults
 * so a whole sale fits in a couple of minutes.
 */
export const SIM_CONFIG = {
  admissionIntervalMs: 1000,
  admissionBatch: 40,
  admissionTtlMs: 300_000,
  holdTtlMs: 45_000,
  paymentDeadlineMs: 30_000,
  holdAfterDeadlineMs: 10_000,
  maxSeatsPerHold: 8,
  paymentDelayMs: 900,
  paymentFailureRate: 0.1,
  relayIntervalMs: 200,
  sweepIntervalMs: 1000,
  rateLimitWindowMs: 10_000,
  rateLimits: { 'queue-join': 5, holds: 10, bookings: 10 } as Record<string, number>,
};

export interface SimOptions {
  now?: () => number;
  random?: () => number;
  /** Advance on a timer. Tests turn this off and call tick() themselves. */
  autoTick?: boolean;
  /** Add realistic response times. Tests turn this off so calls resolve immediately. */
  latency?: boolean;
  /** How long containers and services take to come up, as on `npm run infra:up`. */
  bootMs?: number;
}

type SeatClaim =
  { kind: 'hold'; holdId: string; expiresAt: number } | { kind: 'sold'; bookingId: string };

interface SimEvent {
  info: SaleEvent;
  seats: Omit<Seat, 'status'>[];
  claims: Map<string, SeatClaim>;
  queue: string[];
}

interface Hold {
  id: string;
  eventId: string;
  owner: string;
  seatIds: string[];
  expiresAt: number;
}

interface Booking {
  id: string;
  eventId: string;
  userId: string;
  holdId: string;
  seatIds: string[];
  status: BookingStatus;
  expiresAt: number;
}

interface Message {
  topic: string;
  bookingId: string;
  success?: boolean;
}

interface ConsumerGroup {
  name: string;
  /** The process that runs this consumer; stopping it pauses consumption. */
  owner: string;
  concurrency: number;
  durationMs: number;
  waiting: Message[];
  inFlight: { message: Message; doneAt: number }[];
  handle: (message: Message) => void;
}

const SUBSCRIPTIONS: Record<string, string[]> = {
  'booking.requested': ['payment-service'],
  'payment.completed': ['booking-saga'],
  'booking.confirmed': ['ticket-service', 'seat-sync', 'analytics'],
  'booking.cancelled': ['seat-sync', 'notification-service', 'analytics'],
  'payment.refund-requested': ['payment-service'],
  'ticket.issued': ['notification-service'],
};

const COMPONENTS: [id: string, label: string, kind: 'container' | 'service', detail: string][] = [
  ['postgres', 'PostgreSQL', 'container', 'postgres:18'],
  ['redis', 'Redis', 'container', 'redis:8'],
  ['kafka', 'Kafka (KRaft)', 'container', 'apache/kafka:4'],
  ['kafka-ui', 'Kafka UI', 'container', 'kafbat/kafka-ui'],
  ['kafka-exporter', 'Kafka exporter', 'container', 'consumer lag → Prometheus'],
  ['prometheus', 'Prometheus', 'container', 'scrapes every 5 s'],
  ['grafana', 'Grafana', 'container', 'dashboards'],
  ['api', 'API', 'service', ':3000'],
  ['realtime-gateway', 'Realtime gateway', 'service', ':3001'],
  ['admission-worker', 'Admission worker', 'service', ''],
  ['booking-worker', 'Booking worker', 'service', 'relay · saga · sweeper · seat-sync'],
  ['payment-service', 'Payment service', 'service', '10% failures'],
  ['ticket-service', 'Ticket service', 'service', ''],
  ['notification-service', 'Notification service', 'service', ''],
  ['analytics-service', 'Analytics service', 'service', ''],
];

/** Components the dashboard can stop in simulated mode to show what happens. */
const STOPPABLE = [
  'redis',
  'booking-worker',
  'payment-service',
  'ticket-service',
  'notification-service',
];

/** Rough response times (ms) per route on an idle system; they grow with load. */
const BASE_LATENCY: Record<string, number> = {
  'POST /auth/register': 40,
  'POST /events/:id/queue': 3,
  'GET /events/:id/queue/me': 2,
  'POST /events/:id/holds': 5,
  'DELETE /holds/:holdId': 3,
  'POST /bookings': 14,
  'GET /bookings/:id': 4,
  'GET /events/:id/seats': 9,
};

const METRIC_WINDOW_MS = 5000;

export class SimBackend implements Backend {
  readonly mode = 'simulated' as const;
  readonly chaos: Chaos;

  private readonly now: () => number;
  private readonly random: () => number;
  private readonly latency: boolean;
  private readonly startedAt: number;
  private readonly bootMs: number;
  private readonly timer: ReturnType<typeof setInterval> | undefined;

  private readonly stopped = new Set<string>();
  private readonly users = new Map<string, string>();
  private readonly events = new Map<string, SimEvent>();
  private readonly admitted = new Map<string, number>();
  private readonly holds = new Map<string, Hold>();
  private readonly bookings = new Map<string, Booking>();
  private readonly idempotency = new Map<string, string>();
  /** The partial unique index one_active_booking_per_seat: "eventId:seatId" -> bookingId. */
  private readonly activeSeats = new Map<string, string>();
  private readonly rateLimits = new Map<string, { windowStart: number; count: number }>();
  private readonly outbox: Message[] = [];
  private readonly groups: ConsumerGroup[];
  private readonly listeners = new Map<string, Set<(update: SeatsUpdated) => void>>();

  private lastAdmission = 0;
  private lastRelay = 0;
  private lastSweep = 0;

  // Event logs for rates and latency percentiles: [timestamp, ...].
  private requests: { at: number; route: string; status: number; ms: number }[] = [];
  private consumedLog: { at: number; group: string }[] = [];
  private publishedLog: number[] = [];
  private admittedLog: number[] = [];
  private forwardedLog: number[] = [];

  /** Totals the guarantee panel cross-checks against what the bots saw. */
  readonly totals = { tickets: 0, refunds: 0, notifications: 0, revenueMinor: 0 };

  constructor(options: SimOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.latency = options.latency ?? true;
    this.bootMs = options.bootMs ?? 6000;
    this.startedAt = this.now();
    this.groups = this.createGroups();
    this.chaos = {
      stoppable: STOPPABLE,
      isStopped: (id) => this.stopped.has(id),
      setStopped: (id, stop) => {
        if (stop) this.stopped.add(id);
        else this.stopped.delete(id);
      },
    };
    if (options.autoTick ?? true) {
      this.timer = setInterval(() => {
        this.tick();
      }, 100);
    }
  }

  // ---------- Infrastructure and metrics ----------

  components(): Promise<ComponentStatus[]> {
    return Promise.resolve(
      COMPONENTS.map(([id, label, kind, detail], index) => ({
        id,
        label,
        kind,
        detail: detail || undefined,
        state: this.stopped.has(id) ? 'down' : this.isBooted(index) ? 'up' : 'starting',
      })),
    );
  }

  metrics(): Promise<MetricsSnapshot> {
    const now = this.now();
    const since = now - METRIC_WINDOW_MS;
    const perSecond = (count: number) => count / (METRIC_WINDOW_MS / 1000);
    const snapshot = emptySnapshot(now);

    const recent = this.requests.filter((r) => r.at >= since);
    for (const { status } of recent) {
      const rate = perSecond(1);
      snapshot.http.total += rate;
      if (status === 409) snapshot.http.conflict += rate;
      else if (status === 429) snapshot.http.rateLimited += rate;
      else if (status >= 500 || status === 0) snapshot.http.serverError += rate;
      else if (status >= 400) snapshot.http.clientError += rate;
      else snapshot.http.ok += rate;
    }

    const byRoute = new Map<string, number[]>();
    for (const r of this.requests.filter((x) => x.at >= now - 15_000)) {
      if (!r.route.includes('queue') && !r.route.includes('holds') && r.route !== 'POST /bookings')
        continue;
      byRoute.set(r.route, [...(byRoute.get(r.route) ?? []), r.ms]);
    }
    for (const [route, values] of byRoute) snapshot.p95Ms[route] = percentile(values, 0.95);

    for (const group of this.groups) {
      const done = this.consumedLog.filter((c) => c.at >= since && c.group === group.name).length;
      snapshot.consumed[group.name] = perSecond(done);
      snapshot.lag[group.name] = group.waiting.length + group.inFlight.length;
    }
    snapshot.outboxBacklog = this.outbox.length;
    snapshot.outboxPublished = perSecond(this.publishedLog.filter((t) => t >= since).length);
    snapshot.queueWaiting = [...this.events.values()].reduce((n, e) => n + e.queue.length, 0);
    snapshot.admitted = perSecond(this.admittedLog.filter((t) => t >= since).length);
    snapshot.wsForwarded = perSecond(this.forwardedLog.filter((t) => t >= since).length);
    snapshot.wsConnections = [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
    return Promise.resolve(snapshot);
  }

  // ---------- Events and seats ----------

  prepareSale(options: SaleOptions): Promise<SaleEvent> {
    const id = crypto.randomUUID();
    const seats: SimEvent['seats'] = [];
    for (let s = 0; s < options.sections; s++) {
      for (const row of ROW_LABELS.slice(0, options.rows)) {
        for (let n = 1; n <= options.seatsPerRow; n++) {
          seats.push({
            id: crypto.randomUUID(),
            section: SECTION_NAMES[s] ?? `Section ${s + 1}`,
            row,
            number: n,
            priceMinor: SECTION_PRICES_MINOR[s] ?? 2000,
          });
        }
      }
    }
    const info = {
      id,
      name: 'Flash sale (simulated)',
      venue: 'Demo Arena',
      totalSeats: seats.length,
    };
    this.events.set(id, { info, seats, claims: new Map(), queue: [] });
    return Promise.resolve(info);
  }

  async seats(eventId: string): Promise<SeatMap> {
    await this.respond('GET /events/:id/seats', 200);
    const event = this.events.get(eventId);
    if (!event) throw new Error('Event not found');
    const now = this.now();
    return {
      eventId,
      degraded: this.stopped.has('redis'),
      seats: event.seats.map((seat) => ({ ...seat, status: this.seatStatus(event, seat.id, now) })),
    };
  }

  // ---------- Users and the queue ----------

  async createUser(label: string): Promise<Outcome<{ session: Session }>> {
    const down = this.apiDown();
    if (down) return this.fail('POST /auth/register', down);
    const userId = crypto.randomUUID();
    const email = `bot-${label}@demo.ticketsurge.test`;
    this.users.set(userId, email);
    await this.respond('POST /auth/register', 201);
    return { ok: true, http: 201, session: { userId, email, token: `sim.${userId}` } };
  }

  async joinQueue(session: Session, eventId: string): Promise<Outcome<QueueStatus>> {
    const route = 'POST /events/:id/queue';
    const blocked = this.apiDown() ?? this.redisDown() ?? this.limit('queue-join', session.userId);
    if (blocked) return this.fail(route, blocked);
    const event = this.events.get(eventId);
    if (!event) return this.fail(route, notFound('Event not found'));

    if (!this.isAdmitted(eventId, session.userId) && !event.queue.includes(session.userId)) {
      event.queue.push(session.userId);
    }
    await this.respond(route, 200);
    return { ok: true, http: 200, ...this.queuePosition(event, session.userId) };
  }

  async queueStatus(session: Session, eventId: string): Promise<Outcome<QueueStatus>> {
    const route = 'GET /events/:id/queue/me';
    const blocked = this.apiDown() ?? this.redisDown();
    if (blocked) return this.fail(route, blocked);
    const event = this.events.get(eventId);
    if (!event) return this.fail(route, notFound('Event not found'));
    if (!this.isAdmitted(eventId, session.userId) && !event.queue.includes(session.userId)) {
      return this.fail(route, notFound('Not in the queue for this event'));
    }
    await this.respond(route, 200);
    return { ok: true, http: 200, ...this.queuePosition(event, session.userId) };
  }

  // ---------- Holds ----------

  /** holdSeats: checks admission and every seat, then holds all of them or changes nothing. */
  async hold(
    session: Session,
    eventId: string,
    seatIds: string[],
  ): Promise<Outcome<{ holdId: string; expiresAt: string }>> {
    const route = 'POST /events/:id/holds';
    const blocked = this.apiDown() ?? this.limit('holds', session.userId) ?? this.redisDown();
    if (blocked) return this.fail(route, blocked);
    const event = this.events.get(eventId);
    if (!event) return this.fail(route, notFound('Event not found'));
    if (seatIds.length === 0 || seatIds.length > SIM_CONFIG.maxSeatsPerHold) {
      return this.fail(route, { status: 400, code: 'VALIDATION_ERROR', message: 'bad seatIds' });
    }
    if (!this.isAdmitted(eventId, session.userId)) {
      return this.fail(route, {
        status: 403,
        code: 'NOT_ADMITTED',
        message: 'Join the queue and wait to be admitted first',
      });
    }

    const now = this.now();
    const taken = seatIds.filter((id) => this.seatStatus(event, id, now) !== 'available');
    if (taken.length > 0) {
      return this.fail(route, {
        status: 409,
        code: 'SEATS_UNAVAILABLE',
        message: 'Some seats are no longer available',
      });
    }

    const hold: Hold = {
      id: crypto.randomUUID(),
      eventId,
      owner: session.userId,
      seatIds,
      expiresAt: now + SIM_CONFIG.holdTtlMs,
    };
    this.holds.set(hold.id, hold);
    for (const seatId of seatIds) {
      event.claims.set(seatId, { kind: 'hold', holdId: hold.id, expiresAt: hold.expiresAt });
    }
    this.publishSeats(eventId, seatIds, 'held');
    await this.respond(route, 201);
    return {
      ok: true,
      http: 201,
      holdId: hold.id,
      expiresAt: new Date(hold.expiresAt).toISOString(),
    };
  }

  async releaseHold(session: Session, holdId: string): Promise<Outcome<object>> {
    const route = 'DELETE /holds/:holdId';
    const blocked = this.apiDown() ?? this.redisDown();
    if (blocked) return this.fail(route, blocked);
    if ([...this.bookings.values()].some((b) => b.holdId === holdId)) {
      return this.fail(route, { status: 409, code: 'HOLD_BOOKED', message: 'Hold has a booking' });
    }
    const hold = this.holds.get(holdId);
    if (!hold || hold.owner !== session.userId || hold.expiresAt <= this.now()) {
      return this.fail(route, notFound('Hold not found or already expired'));
    }
    this.releaseSeats(hold);
    this.holds.delete(holdId);
    await this.respond(route, 204);
    return { ok: true, http: 204 };
  }

  // ---------- Bookings ----------

  async book(
    session: Session,
    holdId: string,
    idempotencyKey: string,
  ): Promise<Outcome<{ bookingId: string; status: BookingStatus }>> {
    const route = 'POST /bookings';
    const blocked = this.apiDown() ?? this.limit('bookings', session.userId);
    if (blocked) return this.fail(route, blocked);

    const replayId = this.idempotency.get(`${session.userId}:${idempotencyKey}`);
    const replayed = replayId ? this.bookings.get(replayId) : undefined;
    if (replayed) {
      if (replayed.holdId !== holdId) {
        return this.fail(route, {
          status: 422,
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Key used for another hold',
        });
      }
      await this.respond(route, 202);
      return { ok: true, http: 202, bookingId: replayed.id, status: replayed.status };
    }

    const redisDown = this.redisDown();
    if (redisDown) return this.fail(route, redisDown);
    const now = this.now();
    const hold = this.holds.get(holdId);
    if (!hold || hold.owner !== session.userId || hold.expiresAt <= now) {
      return this.fail(route, {
        status: 409,
        code: 'HOLD_EXPIRED',
        message: 'The hold has expired or does not exist',
      });
    }

    // extendHold, then the transaction: booking + seats + outbox row, guarded by the unique index.
    const event = this.events.get(hold.eventId);
    if (!event) return this.fail(route, notFound('Event not found'));
    if (hold.seatIds.some((seatId) => this.activeSeats.has(`${hold.eventId}:${seatId}`))) {
      this.releaseSeats(hold);
      this.holds.delete(holdId);
      return this.fail(route, {
        status: 409,
        code: 'SEAT_TAKEN',
        message: 'One or more seats were already booked',
      });
    }
    hold.expiresAt = now + SIM_CONFIG.paymentDeadlineMs + SIM_CONFIG.holdAfterDeadlineMs;
    for (const seatId of hold.seatIds) {
      event.claims.set(seatId, { kind: 'hold', holdId, expiresAt: hold.expiresAt });
    }

    const booking: Booking = {
      id: crypto.randomUUID(),
      eventId: hold.eventId,
      userId: session.userId,
      holdId,
      seatIds: hold.seatIds,
      status: 'PENDING_PAYMENT',
      expiresAt: now + SIM_CONFIG.paymentDeadlineMs,
    };
    this.bookings.set(booking.id, booking);
    this.idempotency.set(`${session.userId}:${idempotencyKey}`, booking.id);
    for (const seatId of hold.seatIds)
      this.activeSeats.set(`${hold.eventId}:${seatId}`, booking.id);
    this.outbox.push({ topic: 'booking.requested', bookingId: booking.id });

    await this.respond(route, 202);
    return { ok: true, http: 202, bookingId: booking.id, status: booking.status };
  }

  async booking(session: Session, bookingId: string): Promise<Outcome<{ status: BookingStatus }>> {
    const route = 'GET /bookings/:id';
    const down = this.apiDown();
    if (down) return this.fail(route, down);
    const booking = this.bookings.get(bookingId);
    if (!booking || booking.userId !== session.userId) {
      return this.fail(route, notFound('Booking not found'));
    }
    await this.respond(route, 200);
    return { ok: true, http: 200, status: booking.status };
  }

  // ---------- Realtime ----------

  subscribeSeats(
    _session: Session,
    eventId: string,
    onUpdate: (update: SeatsUpdated) => void,
    onState: (state: SocketState) => void,
  ): () => void {
    const set = this.listeners.get(eventId) ?? new Set();
    set.add(onUpdate);
    this.listeners.set(eventId, set);
    queueMicrotask(() => {
      onState('open');
    });
    return () => {
      set.delete(onUpdate);
      onState('closed');
    };
  }

  dispose(): void {
    clearInterval(this.timer);
    this.listeners.clear();
  }

  // ---------- Background work: admission, relay, consumers, sweeper ----------

  /** Advances every background process to the current time. */
  tick(): void {
    const now = this.now();
    this.expireHolds(now);

    if (now - this.lastAdmission >= SIM_CONFIG.admissionIntervalMs) {
      this.lastAdmission = now;
      if (this.running('admission-worker') && !this.stopped.has('redis')) this.admitNext(now);
    }

    // Outbox relay (inside booking-worker): publishes rows in order, then marks them published.
    if (now - this.lastRelay >= SIM_CONFIG.relayIntervalMs) {
      this.lastRelay = now;
      if (this.running('booking-worker') && !this.stopped.has('kafka')) {
        for (const message of this.outbox.splice(0, 200)) {
          this.publish(message);
          this.publishedLog.push(now);
        }
      }
    }

    for (const group of this.groups) {
      const finished = group.inFlight.filter((f) => f.doneAt <= now);
      group.inFlight = group.inFlight.filter((f) => f.doneAt > now);
      for (const { message } of finished) {
        group.handle(message);
        this.consumedLog.push({ at: now, group: group.name });
      }
      if (!this.running(group.owner)) continue;
      while (group.inFlight.length < group.concurrency && group.waiting.length > 0) {
        const message = group.waiting.shift();
        if (!message) break;
        const jitter = 0.7 + this.random() * 0.6;
        group.inFlight.push({ message, doneAt: now + group.durationMs * jitter });
      }
    }

    // Expiry sweeper: pauses while the relay lags, since payments may not have arrived yet.
    if (now - this.lastSweep >= SIM_CONFIG.sweepIntervalMs) {
      this.lastSweep = now;
      if (this.running('booking-worker') && this.outbox.length < 1000) this.sweep(now);
    }

    this.pruneLogs(now - 30_000);
  }

  private createGroups(): ConsumerGroup[] {
    const group = (
      name: string,
      owner: string,
      concurrency: number,
      durationMs: number,
      handle: (m: Message) => void,
    ): ConsumerGroup => ({
      name,
      owner,
      concurrency,
      durationMs,
      waiting: [],
      inFlight: [],
      handle,
    });

    return [
      // Six partitions, each blocked for the simulated payment delay.
      group('payment-service', 'payment-service', 6, SIM_CONFIG.paymentDelayMs, (m) => {
        if (m.topic === 'payment.refund-requested') {
          this.totals.refunds++;
          return;
        }
        const success = this.random() >= SIM_CONFIG.paymentFailureRate;
        this.publish({ topic: 'payment.completed', bookingId: m.bookingId, success });
      }),
      group('booking-saga', 'booking-worker', 6, 15, (m) => {
        this.applyPayment(m);
      }),
      group('seat-sync', 'booking-worker', 6, 5, (m) => {
        this.syncSeats(m);
      }),
      group('ticket-service', 'ticket-service', 6, 20, (m) => {
        const booking = this.bookings.get(m.bookingId);
        if (!booking) return;
        this.totals.tickets += booking.seatIds.length;
        this.publish({ topic: 'ticket.issued', bookingId: m.bookingId });
      }),
      group('notification-service', 'notification-service', 6, 25, () => {
        this.totals.notifications++;
      }),
      group('analytics', 'analytics-service', 6, 10, (m) => {
        const booking = this.bookings.get(m.bookingId);
        if (m.topic === 'booking.confirmed' && booking) {
          const event = this.events.get(booking.eventId);
          for (const seatId of booking.seatIds) {
            this.totals.revenueMinor += event?.seats.find((s) => s.id === seatId)?.priceMinor ?? 0;
          }
        }
      }),
    ];
  }

  /** booking-saga: a conditional update, so a payment result and the sweeper cannot both win. */
  private applyPayment(message: Message) {
    const booking = this.bookings.get(message.bookingId);
    if (!booking) return;
    if (booking.status !== 'PENDING_PAYMENT') {
      // Paid after the sweeper expired it: refund, never restore the seats.
      if (booking.status === 'EXPIRED' && message.success) {
        this.outbox.push({ topic: 'payment.refund-requested', bookingId: booking.id });
      }
      return;
    }
    if (message.success) {
      booking.status = 'CONFIRMED';
      this.outbox.push({ topic: 'booking.confirmed', bookingId: booking.id });
    } else {
      this.endBooking(booking, 'CANCELLED');
    }
  }

  private sweep(now: number) {
    for (const booking of this.bookings.values()) {
      if (booking.status === 'PENDING_PAYMENT' && booking.expiresAt <= now) {
        this.endBooking(booking, 'EXPIRED');
      }
    }
  }

  private endBooking(booking: Booking, status: 'CANCELLED' | 'EXPIRED') {
    booking.status = status;
    for (const seatId of booking.seatIds) this.activeSeats.delete(`${booking.eventId}:${seatId}`);
    this.outbox.push({ topic: 'booking.cancelled', bookingId: booking.id });
  }

  /** seat-sync: markSold on confirmation, releaseHold on cancellation. Both are safe to repeat. */
  private syncSeats(message: Message) {
    const booking = this.bookings.get(message.bookingId);
    const event = booking ? this.events.get(booking.eventId) : undefined;
    if (!booking || !event) return;
    if (this.stopped.has('redis')) {
      // Redis is down: put the message back so it is retried, as the real consumer's backoff would.
      this.groups.find((g) => g.name === 'seat-sync')?.waiting.push(message);
      return;
    }
    if (message.topic === 'booking.confirmed') {
      for (const seatId of booking.seatIds) {
        event.claims.set(seatId, { kind: 'sold', bookingId: booking.id });
      }
      this.holds.delete(booking.holdId);
      this.publishSeats(booking.eventId, booking.seatIds, 'sold');
    } else {
      const hold = this.holds.get(booking.holdId);
      if (hold) {
        this.releaseSeats(hold);
        this.holds.delete(hold.id);
      }
    }
  }

  private admitNext(now: number) {
    for (const event of this.events.values()) {
      for (const userId of event.queue.splice(0, SIM_CONFIG.admissionBatch)) {
        this.admitted.set(`${event.info.id}:${userId}`, now + SIM_CONFIG.admissionTtlMs);
        this.admittedLog.push(now);
      }
    }
  }

  private expireHolds(now: number) {
    for (const hold of this.holds.values()) {
      if (hold.expiresAt > now) continue;
      this.holds.delete(hold.id);
      this.releaseSeats(hold);
    }
  }

  private publish(message: Message) {
    for (const name of SUBSCRIPTIONS[message.topic] ?? []) {
      this.groups.find((g) => g.name === name)?.waiting.push(message);
    }
  }

  // ---------- Helpers ----------

  private releaseSeats(hold: Hold) {
    const event = this.events.get(hold.eventId);
    if (!event) return;
    const released: string[] = [];
    for (const seatId of hold.seatIds) {
      const claim = event.claims.get(seatId);
      // releaseHold only deletes a seat that still belongs to this hold.
      if (claim?.kind === 'hold' && claim.holdId === hold.id) {
        event.claims.delete(seatId);
        released.push(seatId);
      }
    }
    if (released.length > 0) this.publishSeats(hold.eventId, released, 'available');
  }

  private seatStatus(event: SimEvent, seatId: string, now: number): SeatStatus {
    const claim = event.claims.get(seatId);
    if (!claim) return 'available';
    if (claim.kind === 'sold') return 'sold';
    return claim.expiresAt > now ? 'held' : 'available';
  }

  private publishSeats(eventId: string, seatIds: string[], status: SeatStatus) {
    if (this.stopped.has('realtime-gateway')) return;
    const now = this.now();
    for (const listener of this.listeners.get(eventId) ?? []) {
      listener({ seatIds, status });
      this.forwardedLog.push(now);
    }
  }

  private queuePosition(event: SimEvent, userId: string): QueueStatus {
    if (this.isAdmitted(event.info.id, userId)) return { admitted: true, position: 0 };
    return { admitted: false, position: event.queue.indexOf(userId) + 1 };
  }

  private isAdmitted(eventId: string, userId: string) {
    return (this.admitted.get(`${eventId}:${userId}`) ?? 0) > this.now();
  }

  private isBooted(index: number) {
    if (this.bootMs === 0) return true;
    const containers = COMPONENTS.filter(([, , kind]) => kind === 'container').length;
    // Containers come up first, then the Node services, like infra:up followed by npm run dev:*.
    const step = index < containers ? index * 0.08 : 0.6 + (index - containers) * 0.05;
    return this.now() - this.startedAt >= this.bootMs * step + 300;
  }

  private running(id: string) {
    const index = COMPONENTS.findIndex(([name]) => name === id);
    return !this.stopped.has(id) && this.isBooted(index);
  }

  private apiDown(): Failure | undefined {
    if (this.running('api') && this.running('postgres')) return undefined;
    return { status: 0, code: 'NETWORK_ERROR', message: 'API not reachable' };
  }

  private redisDown(): Failure | undefined {
    if (!this.stopped.has('redis')) return undefined;
    return { status: 503, code: 'REDIS_UNAVAILABLE', message: 'Redis is unavailable' };
  }

  /** Fixed-window rate limit per user and route, like rl:{route}:{userId}. */
  private limit(route: string, userId: string): Failure | undefined {
    const max = SIM_CONFIG.rateLimits[route];
    if (max === undefined) return undefined;
    const now = this.now();
    const key = `${route}:${userId}`;
    const state = this.rateLimits.get(key);
    if (!state || now - state.windowStart >= SIM_CONFIG.rateLimitWindowMs) {
      this.rateLimits.set(key, { windowStart: now, count: 1 });
      return undefined;
    }
    state.count++;
    if (state.count <= max) return undefined;
    return {
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests, slow down',
      retryAfterMs: state.windowStart + SIM_CONFIG.rateLimitWindowMs - now,
    };
  }

  private async respond(route: string, status: number) {
    const ms = this.responseTime(route);
    this.requests.push({ at: this.now(), route, status, ms });
    if (this.latency) await sleep(ms);
  }

  private async fail(route: string, failure: Failure): Promise<Outcome<never>> {
    if (failure.status !== 0) await this.respond(route, failure.status);
    const { status, ...rest } = failure;
    return { ok: false, http: status, ...rest };
  }

  /** Response time grows with the current request rate, so the latency chart reacts to load. */
  private responseTime(route: string) {
    const base = BASE_LATENCY[route] ?? 5;
    const load = this.requests.filter((r) => r.at >= this.now() - 1000).length;
    return base * (1 + load / 400) * (0.6 + this.random() * 0.9);
  }

  private pruneLogs(before: number) {
    this.requests = this.requests.filter((r) => r.at >= before);
    this.consumedLog = this.consumedLog.filter((c) => c.at >= before);
    this.publishedLog = this.publishedLog.filter((t) => t >= before);
    this.admittedLog = this.admittedLog.filter((t) => t >= before);
    this.forwardedLog = this.forwardedLog.filter((t) => t >= before);
  }

  // Test helpers.
  /** Seats with more than one active booking. The guarantee says this is always zero. */
  doubleBookedSeats(): number {
    const counts = new Map<string, number>();
    for (const booking of this.bookings.values()) {
      if (booking.status !== 'PENDING_PAYMENT' && booking.status !== 'CONFIRMED') continue;
      for (const seatId of booking.seatIds) {
        const key = `${booking.eventId}:${seatId}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.values()].filter((n) => n > 1).length;
  }

  bookingStatuses(): BookingStatus[] {
    return [...this.bookings.values()].map((b) => b.status);
  }
}

interface Failure {
  status: number;
  code: string;
  message: string;
  retryAfterMs?: number;
}

const notFound = (message: string): Failure => ({ status: 404, code: 'NOT_FOUND', message });

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
