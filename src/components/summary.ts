import type { BotPhase } from '../lib/bots/swarm';
import { formatInt } from '../lib/format';
import type { DashboardState } from '../state/dashboard';

/** Counts shared by the counters, the status line and How it works. */
export function saleNumbers(state: DashboardState) {
  const swarm = state.sale.swarm;
  let left = 0;
  let booked = 0;
  for (const seat of state.sale.seats) {
    if (seat.status === 'available') left++;
    else if (seat.status === 'sold') booked++;
  }
  const groups = swarm ? crowdGroups(swarm.phases) : undefined;
  return {
    waiting: (swarm?.phases.queued ?? 0) + (state.buyer?.step === 'queued' ? 1 : 0),
    got: groups?.got ?? 0,
    missed: groups?.missed ?? 0,
    replays: swarm?.idempotentReplays ?? 0,
    socket: state.sale.socket,
    left,
    booked,
    seats: state.sale.seats.length,
    buyers: swarm?.bots.length ?? 0,
    twice: swarm?.doubleSold ?? 0,
    refused: swarm?.conflicts ?? 0,
    slowedDown: swarm?.rateLimited ?? 0,
    lag: Object.values(state.metrics?.lag ?? {}).reduce((a, b) => a + b, 0),
  };
}

export type SaleNumbers = ReturnType<typeof saleNumbers>;

/** The crowd in four plain groups, in the order a buyer moves through them. */
export type CrowdGroup = 'line' | 'trying' | 'got' | 'missed';

export const CROWD_GROUPS: { id: CrowdGroup; label: string; phases: readonly BotPhase[] }[] = [
  { id: 'line', label: 'In line', phases: ['registering', 'queued'] },
  { id: 'trying', label: 'Choosing or paying', phases: ['holding', 'booking', 'paying'] },
  { id: 'got', label: 'Got tickets', phases: ['confirmed'] },
  {
    id: 'missed',
    label: "Didn't get one",
    phases: ['lost', 'cancelled', 'expired', 'abandoned', 'failed'],
  },
];

export function crowdGroups(phases: Record<BotPhase, number>): Record<CrowdGroup, number> {
  const counts = { line: 0, trying: 0, got: 0, missed: 0 };
  for (const group of CROWD_GROUPS) {
    for (const phase of group.phases) counts[group.id] += phases[phase];
  }
  return counts;
}

/** 41 s, or 2 min 05 s. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** One sentence for a finished sale. */
export function finishedSentence({
  ms,
  sold,
  seats,
  buyers,
  got,
  refused,
  twice,
}: {
  ms: number;
  sold: number;
  seats: number;
  buyers: number;
  got: number;
  refused: number;
  twice: number;
}): string {
  return [
    `Sale over in ${formatDuration(ms)}.`,
    `${formatInt(sold)} of ${formatInt(seats)} seats sold; ${formatInt(got)} of ${formatInt(buyers)} buyers got tickets.`,
    `${formatInt(refused)} double sales refused with a 409, ${formatInt(twice)} got through.`,
  ].join(' ');
}
