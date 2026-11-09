import { describe, expect, it } from 'vitest';
import type { Seat, SeatStatus } from '../types';
import { SimBackend } from '../sim/sim-backend';
import { limiter, Swarm, type SwarmOptions } from './swarm';

/** Seeded PRNG (mulberry32), so a failing run can be reproduced. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Runs a whole flash sale on a virtual clock: bots' sleeps and the simulation's background work
 * both advance in 100 ms steps, so minutes of sale run in well under a second.
 */
async function runSale(
  seed: number,
  options: Partial<SwarmOptions>,
  seats: number,
  during?: (swarm: Swarm, clock: number) => void,
) {
  let clock = 0;
  const random = seeded(seed);
  const sim = new SimBackend({
    now: () => clock,
    random,
    autoTick: false,
    latency: false,
    bootMs: 0,
  });
  const event = await sim.prepareSale({ sections: 1, rows: 1, seatsPerRow: seats });
  let view: Seat[] = (await sim.seats(event.id)).seats;
  const unsubscribe = sim.subscribeSeats(
    { userId: 'observer', email: '', token: '' },
    event.id,
    ({ seatIds, status }) => {
      view = view.map((s) => (seatIds.includes(s.id) ? { ...s, status } : s));
    },
    () => undefined,
  );

  const timers: { at: number; resolve: () => void }[] = [];
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => timers.push({ at: clock + ms, resolve }));

  const swarm = new Swarm(
    sim,
    event,
    {
      seats: () => view,
      mark: (ids: readonly string[], status: SeatStatus) => {
        view = view.map((s) => (ids.includes(s.id) ? { ...s, status } : s));
      },
    },
    {
      bots: 60,
      abandonRate: 0.1,
      retryRate: 0.3,
      maxSeatsPerBot: 4,
      registerConcurrency: 8,
      ...options,
    },
    random,
    sleep,
  );

  const progress = { done: false };
  const finished = swarm.run().then(() => {
    progress.done = true;
  });
  while (!progress.done && clock < 15 * 60_000) {
    await flush();
    clock += 100;
    during?.(swarm, clock);
    sim.tick();
    for (const timer of timers.filter((t) => t.at <= clock)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.resolve();
    }
  }
  await finished;
  unsubscribe();
  return { sim, swarm, event };
}

describe('Swarm against the simulated backend', () => {
  it.each([1, 2, 3])('never sells a seat twice (seed %i)', async (seed) => {
    const { sim, swarm } = await runSale(seed, {}, 30);
    const result = swarm.snapshot();

    expect(result.running).toBe(false);
    expect(result.doubleSold).toBe(0);
    expect(result.replayMismatches).toBe(0);
    expect(sim.doubleBookedSeats()).toBe(0);
    // 60 buyers wanting about two seats each for 30 seats: there must be losers and conflicts.
    expect(result.seatsConfirmed).toBeLessThanOrEqual(30);
    expect(result.phases.lost).toBeGreaterThan(0);
    // Every bot reached an end state.
    const active = result.phases.registering + result.phases.queued + result.phases.holding;
    expect(active + result.phases.booking + result.phases.paying).toBe(0);
  });

  it('sees confirmed seats as sold in the backend', async () => {
    const { sim, swarm, event } = await runSale(7, { abandonRate: 0 }, 40);
    const sold = (await sim.seats(event.id)).seats.filter((s) => s.status === 'sold').length;
    expect(sold).toBe(swarm.snapshot().seatsConfirmed);
  });

  it.each([11, 12])('stays correct when a surge joins mid-sale (seed %i)', async (seed) => {
    const added: number[] = [];
    const { sim, swarm } = await runSale(seed, { bots: 20 }, 30, (s, clock) => {
      if (clock === 1000) added.push(s.addBots(50));
      if (clock === 2000) added.push(s.addBots(30));
    });
    const result = swarm.snapshot();

    expect(added).toEqual([50, 30]);
    expect(result.bots).toHaveLength(100);
    expect(result.doubleSold).toBe(0);
    expect(sim.doubleBookedSeats()).toBe(0);
    expect(result.seatsConfirmed).toBeLessThanOrEqual(30);
    // Late arrivals are followed to an end state too, not abandoned when the first wave ends.
    const active = result.phases.registering + result.phases.queued + result.phases.holding;
    expect(active + result.phases.booking + result.phases.paying).toBe(0);
  });

  it('caps the crowd at maxBots, and adds nobody once stopped', async () => {
    const added: number[] = [];
    await runSale(21, { bots: 20, maxBots: 25 }, 30, (s, clock) => {
      if (clock === 500) added.push(s.addBots(10));
      if (clock === 600) added.push(s.addBots(10));
      if (clock === 700) {
        s.stop();
        added.push(s.addBots(10));
      }
    });
    expect(added).toEqual([5, 0, 0]);
  });
});

describe('limiter', () => {
  it('never runs more than the limit at once', async () => {
    const limit = limiter(3);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await flush();
          active--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });
});
