import { describe, expect, it } from 'vitest';
import type { Session } from '../backend';
import { SimBackend } from '../sim/sim-backend';
import type { Seat, SeatStatus } from '../types';
import { BuyerJourney, MAX_SEATS, type JourneyStep } from './journey';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A journey against the simulation on a virtual clock, with a visitor's clicks in between. */
async function setup({ random = (): number => 0.5, seats = 8 } = {}) {
  let clock = 1_000;
  const sim = new SimBackend({
    now: () => clock,
    random,
    autoTick: false,
    latency: false,
    bootMs: 0,
  });
  const event = await sim.prepareSale({ sections: 1, rows: 1, seatsPerRow: seats });
  let view: Seat[] = (await sim.seats(event.id)).seats;
  const mark = (ids: readonly string[], status: SeatStatus) => {
    view = view.map((s) => (ids.includes(s.id) ? { ...s, status } : s));
  };
  sim.subscribeSeats(
    { userId: 'observer', email: '', token: '' },
    event.id,
    ({ seatIds, status }) => {
      mark(seatIds, status);
    },
    () => undefined,
  );

  const timers: { at: number; resolve: () => void }[] = [];
  const journey = new BuyerJourney(sim, event, { seats: () => view, mark }, () => undefined, {
    now: () => clock,
    sleep: (ms) => new Promise<void>((resolve) => timers.push({ at: clock + ms, resolve })),
  });

  /** Advances virtual time until the journey reaches `step`. */
  const until = async (step: JourneyStep, limitMs = 120_000) => {
    const end = clock + limitMs;
    while (journey.snapshot().step !== step) {
      if (clock >= end) throw new Error(`stuck at ${journey.snapshot().step}, wanted ${step}`);
      await flush();
      clock += 100;
      sim.tick();
      journey.tick();
      for (const timer of timers.filter((t) => t.at <= clock)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.resolve();
      }
    }
  };

  const rival = async (): Promise<Session> => {
    const created = await sim.createUser('rival');
    if (!created.ok) throw new Error('rival sign-up failed');
    await sim.joinQueue(created.session, event.id);
    return created.session;
  };

  return {
    sim,
    event,
    journey,
    until,
    rival,
    tick: () => {
      clock += 1100;
      sim.tick();
    },
    view: () => view,
    status: (id: string) => view.find((s) => s.id === id)?.status,
  };
}

function seatId(view: readonly Seat[], index: number): string {
  const seat = view[index];
  if (!seat) throw new Error(`no seat ${index}`);
  return seat.id;
}

/** Plays the journey up to the point where seats can be chosen. */
async function admitted(ctx: Awaited<ReturnType<typeof setup>>) {
  void ctx.journey.start();
  await ctx.until('picking');
}

describe('BuyerJourney', () => {
  it('walks from sign-up to a confirmed booking, and the seat ends up sold', async () => {
    const ctx = await setup();
    await admitted(ctx);

    const seat = seatId(ctx.view(), 0);
    ctx.journey.toggleSeat(seat);
    void ctx.journey.holdSelected();
    await ctx.until('held');
    expect(ctx.journey.snapshot().seats).toEqual([seat]);
    expect(ctx.status(seat)).toBe('held');

    void ctx.journey.pay();
    await ctx.until('confirmed');
    expect(ctx.journey.snapshot().bookingId).toBeDefined();
    expect(ctx.status(seat)).toBe('sold');
    expect(ctx.sim.doubleBookedSeats()).toBe(0);

    const traces = ctx.journey.snapshot().log.flatMap((e) => (e.trace ? [e.trace] : []));
    expect(traces).toEqual(['confirmed', 'book', 'hold', 'admitted', 'queue', 'signup']);
  });

  it('waits behind the people who queued first', async () => {
    const ctx = await setup();
    for (let i = 0; i < 3; i++) await ctx.rival();

    void ctx.journey.start();
    for (let i = 0; i < 20 && ctx.journey.snapshot().position === undefined; i++) await flush();
    expect(ctx.journey.snapshot().step).toBe('queued');
    expect(ctx.journey.snapshot().position).toBe(4);
    await ctx.until('picking');
  });

  it('keeps nothing when a chosen seat is taken before the hold', async () => {
    const ctx = await setup();
    await admitted(ctx);
    const contested = seatId(ctx.view(), 0);
    const free = seatId(ctx.view(), 1);
    ctx.journey.toggleSeat(contested);
    ctx.journey.toggleSeat(free);

    const other = await ctx.rival();
    ctx.tick(); // the admission worker lets the rival in
    const taken = await ctx.sim.hold(other, ctx.event.id, [contested]);
    expect(taken.ok).toBe(true);

    void ctx.journey.holdSelected();
    await flush();
    await ctx.until('picking');
    const snapshot = ctx.journey.snapshot();
    expect(snapshot.selected).toEqual([]);
    expect(snapshot.seats).toEqual([]);
    expect(snapshot.log[0]).toMatchObject({ http: 409, trace: 'hold-rejected' });
    // All or nothing: the seat that was free when the hold failed is still free.
    expect(ctx.status(free)).toBe('available');
  });

  it('frees the seats when the hold runs out', async () => {
    const ctx = await setup();
    await admitted(ctx);
    const seat = seatId(ctx.view(), 2);
    ctx.journey.toggleSeat(seat);
    void ctx.journey.holdSelected();
    await ctx.until('held');
    await ctx.until('hold-lost');
    expect(ctx.status(seat)).toBe('available');
  });

  it('releases the seats on request', async () => {
    const ctx = await setup();
    await admitted(ctx);
    const seat = seatId(ctx.view(), 3);
    ctx.journey.toggleSeat(seat);
    void ctx.journey.holdSelected();
    await ctx.until('held');

    void ctx.journey.release();
    await ctx.until('released');
    await flush();
    expect(ctx.status(seat)).toBe('available');
    expect(ctx.journey.snapshot().log[0]).toMatchObject({ http: 204, trace: 'release' });
  });

  it('gives the seats back when the payment fails', async () => {
    // Every random draw is below the failure rate, so the simulated charge is declined.
    const ctx = await setup({ random: () => 0.01 });
    await admitted(ctx);
    const seat = seatId(ctx.view(), 4);
    ctx.journey.toggleSeat(seat);
    void ctx.journey.holdSelected();
    await ctx.until('held');

    void ctx.journey.pay();
    await ctx.until('cancelled');
    expect(ctx.status(seat)).toBe('available');
  });

  it('limits the selection and refuses seats that are not free', async () => {
    const ctx = await setup();
    await admitted(ctx);
    const ids = ctx.view().map((s) => s.id);
    for (const id of ids.slice(0, MAX_SEATS + 2)) ctx.journey.toggleSeat(id);
    expect(ctx.journey.snapshot().selected).toHaveLength(MAX_SEATS);

    const first = seatId(ctx.view(), 0);
    ctx.journey.toggleSeat(first);
    expect(ctx.journey.snapshot().selected).not.toContain(first);

    const other = await ctx.rival();
    ctx.tick();
    const lastId = seatId(ctx.view(), 7);
    await ctx.sim.hold(other, ctx.event.id, [lastId]);
    ctx.journey.toggleSeat(first);
    ctx.journey.toggleSeat(seatId(ctx.view(), 1)); // deselect one to make room
    ctx.journey.toggleSeat(lastId);
    expect(ctx.journey.snapshot().selected).not.toContain(lastId);
  });

  it('changes nothing after stop()', async () => {
    const ctx = await setup();
    void ctx.journey.start();
    ctx.journey.stop();
    await flush();
    await flush();
    expect(ctx.journey.snapshot().step).toBe('signing-in');
  });
});
