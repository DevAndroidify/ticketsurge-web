import { describe, expect, it } from 'vitest';
import type { Session } from '../backend';
import { SIM_CONFIG, SimBackend } from './sim-backend';

/** A simulation on a hand-driven clock: nothing happens until advance() is called. */
function setup(random: () => number = () => 0.5) {
  let clock = 1_000_000;
  const sim = new SimBackend({
    now: () => clock,
    random,
    autoTick: false,
    latency: false,
    bootMs: 0,
  });
  const advance = (ms: number) => {
    const end = clock + ms;
    while (clock < end) {
      clock = Math.min(end, clock + 100);
      sim.tick();
    }
  };
  return { sim, advance };
}

async function user(sim: SimBackend, label: string): Promise<Session> {
  const result = await sim.createUser(label);
  if (!result.ok) throw new Error(result.code);
  return result.session;
}

async function admittedUser(sim: SimBackend, advance: (ms: number) => void, eventId: string) {
  const session = await user(sim, crypto.randomUUID());
  await sim.joinQueue(session, eventId);
  advance(SIM_CONFIG.admissionIntervalMs);
  return session;
}

async function heldBooking(sim: SimBackend, advance: (ms: number) => void) {
  const event = await sim.prepareSale({ sections: 1, rows: 1, seatsPerRow: 4 });
  const map = await sim.seats(event.id);
  const seatIds = map.seats.slice(0, 2).map((s) => s.id);
  const session = await admittedUser(sim, advance, event.id);
  const hold = await sim.hold(session, event.id, seatIds);
  if (!hold.ok) throw new Error(hold.code);
  const booking = await sim.book(session, hold.holdId, 'key-1');
  if (!booking.ok) throw new Error(booking.code);
  return { event, seatIds, session, bookingId: booking.bookingId };
}

describe('SimBackend', () => {
  it('lets exactly one of 100 parallel holds on the same seat succeed', async () => {
    const { sim, advance } = setup();
    const event = await sim.prepareSale({ sections: 1, rows: 1, seatsPerRow: 10 });
    const seatId = (await sim.seats(event.id)).seats[0]?.id ?? '';
    const users = await Promise.all(Array.from({ length: 100 }, (_, i) => user(sim, `u${i}`)));
    await Promise.all(users.map((u) => sim.joinQueue(u, event.id)));
    advance(SIM_CONFIG.admissionIntervalMs * 3);

    const results = await Promise.all(users.map((u) => sim.hold(u, event.id, [seatId])));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.http === 409)).toHaveLength(99);
  });

  it('holds all requested seats or none of them', async () => {
    const { sim, advance } = setup();
    const event = await sim.prepareSale({ sections: 1, rows: 1, seatsPerRow: 3 });
    const [a, b, c] = (await sim.seats(event.id)).seats.map((s) => s.id);
    const first = await admittedUser(sim, advance, event.id);
    const second = await admittedUser(sim, advance, event.id);

    expect((await sim.hold(first, event.id, [b ?? ''])).ok).toBe(true);
    const overlapping = await sim.hold(second, event.id, [a ?? '', b ?? '', c ?? '']);
    expect(overlapping.ok).toBe(false);
    const statuses = (await sim.seats(event.id)).seats.map((s) => s.status);
    expect(statuses).toEqual(['available', 'held', 'available']);
  });

  it('rejects holds from users who were not admitted yet', async () => {
    const { sim } = setup();
    const event = await sim.prepareSale({ sections: 1, rows: 1, seatsPerRow: 2 });
    const session = await user(sim, 'early');
    await sim.joinQueue(session, event.id);
    const seatId = (await sim.seats(event.id)).seats[0]?.id ?? '';
    const result = await sim.hold(session, event.id, [seatId]);
    expect(result).toMatchObject({ ok: false, http: 403, code: 'NOT_ADMITTED' });
  });

  it('admits waiting users in the order they joined', async () => {
    const { sim, advance } = setup();
    const event = await sim.prepareSale({ sections: 1, rows: 1, seatsPerRow: 2 });
    const users = await Promise.all(
      Array.from({ length: SIM_CONFIG.admissionBatch + 5 }, (_, i) => user(sim, `q${i}`)),
    );
    for (const u of users) await sim.joinQueue(u, event.id);
    advance(SIM_CONFIG.admissionIntervalMs);

    const statuses = await Promise.all(users.map((u) => sim.queueStatus(u, event.id)));
    const admitted = statuses.map((s) => s.ok && s.admitted);
    expect(admitted.slice(0, SIM_CONFIG.admissionBatch).every(Boolean)).toBe(true);
    expect(admitted.slice(SIM_CONFIG.admissionBatch).some(Boolean)).toBe(false);
    expect(statuses.at(-1)).toMatchObject({ ok: true, position: 5 });
  });

  it('confirms a paid booking and marks its seats sold', async () => {
    const { sim, advance } = setup(() => 0.5); // 0.5 >= failure rate: payment succeeds
    const { event, session, bookingId } = await heldBooking(sim, advance);
    advance(5000);

    expect(await sim.booking(session, bookingId)).toMatchObject({ ok: true, status: 'CONFIRMED' });
    const sold = (await sim.seats(event.id)).seats.filter((s) => s.status === 'sold');
    expect(sold).toHaveLength(2);
    expect(sim.totals.tickets).toBe(2);
    expect(sim.doubleBookedSeats()).toBe(0);
  });

  it('cancels the booking and frees the seats when payment fails', async () => {
    const { sim, advance } = setup(() => 0.01); // below the failure rate: payment fails
    const { event, session, bookingId } = await heldBooking(sim, advance);
    advance(5000);

    expect(await sim.booking(session, bookingId)).toMatchObject({ ok: true, status: 'CANCELLED' });
    const statuses = (await sim.seats(event.id)).seats.map((s) => s.status);
    expect(statuses.every((s) => s === 'available')).toBe(true);
  });

  it('expires an unpaid booking and refunds a payment that arrives too late', async () => {
    const { sim, advance } = setup(() => 0.5);
    sim.chaos.setStopped('payment-service', true);
    const { session, bookingId } = await heldBooking(sim, advance);
    advance(SIM_CONFIG.paymentDeadlineMs + 2000);
    expect(await sim.booking(session, bookingId)).toMatchObject({ ok: true, status: 'EXPIRED' });

    sim.chaos.setStopped('payment-service', false);
    advance(5000);
    expect(await sim.booking(session, bookingId)).toMatchObject({ ok: true, status: 'EXPIRED' });
    expect(sim.totals.refunds).toBe(1);
  });

  it('returns the same booking for a repeated Idempotency-Key', async () => {
    const { sim, advance } = setup();
    const event = await sim.prepareSale({ sections: 1, rows: 1, seatsPerRow: 2 });
    const seatId = (await sim.seats(event.id)).seats[0]?.id ?? '';
    const session = await admittedUser(sim, advance, event.id);
    const hold = await sim.hold(session, event.id, [seatId]);
    if (!hold.ok) throw new Error(hold.code);

    const [a, b] = await Promise.all([
      sim.book(session, hold.holdId, 'same-key'),
      sim.book(session, hold.holdId, 'same-key'),
    ]);
    expect(a.ok && b.ok && a.bookingId === b.bookingId).toBe(true);
    expect(sim.bookingStatuses()).toHaveLength(1);
  });

  it('rate-limits queue joins per user', async () => {
    const { sim } = setup();
    const event = await sim.prepareSale({ sections: 1, rows: 1, seatsPerRow: 2 });
    const session = await user(sim, 'eager');
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await sim.joinQueue(session, event.id));
    expect(results.filter((r) => r.ok)).toHaveLength(SIM_CONFIG.rateLimits['queue-join'] ?? 0);
    expect(results.at(-1)).toMatchObject({ ok: false, http: 429 });
  });

  it('answers holds with 503 while Redis is down, and never holds without it', async () => {
    const { sim, advance } = setup();
    const event = await sim.prepareSale({ sections: 1, rows: 1, seatsPerRow: 2 });
    const seatId = (await sim.seats(event.id)).seats[0]?.id ?? '';
    const session = await admittedUser(sim, advance, event.id);

    sim.chaos.setStopped('redis', true);
    expect(await sim.hold(session, event.id, [seatId])).toMatchObject({ ok: false, http: 503 });
    sim.chaos.setStopped('redis', false);
    expect((await sim.hold(session, event.id, [seatId])).ok).toBe(true);
  });

  it('builds outbox backlog while the booking worker is stopped, and loses nothing', async () => {
    const { sim, advance } = setup(() => 0.5);
    sim.chaos.setStopped('booking-worker', true);
    const { session, bookingId } = await heldBooking(sim, advance);
    advance(3000);
    expect((await sim.metrics()).outboxBacklog).toBe(1);
    expect(await sim.booking(session, bookingId)).toMatchObject({ status: 'PENDING_PAYMENT' });

    sim.chaos.setStopped('booking-worker', false);
    advance(5000);
    expect((await sim.metrics()).outboxBacklog).toBe(0);
    expect(await sim.booking(session, bookingId)).toMatchObject({ status: 'CONFIRMED' });
  });

  it('reports containers as starting until they have booted', async () => {
    let clock = 0;
    const sim = new SimBackend({ now: () => clock, autoTick: false, bootMs: 6000 });
    expect((await sim.components()).every((c) => c.state === 'starting')).toBe(true);
    clock = 10_000;
    expect((await sim.components()).every((c) => c.state === 'up')).toBe(true);
  });
});
