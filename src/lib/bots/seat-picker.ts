import type { Seat } from '../types';

/**
 * Picks seats the way a crowd does: most people go for the best section first, and they want
 * seats next to each other. Many bots picking from the same stale view is exactly what makes them
 * collide, and the backend has to turn all but one of them away.
 */
export function pickSeats(seats: readonly Seat[], wanted: number, random: () => number): string[] {
  const free = seats.filter((seat) => seat.status === 'available');
  if (free.length === 0 || wanted < 1) return [];

  const sections = [...new Set(free.map((seat) => seat.section))];
  const order = [...new Set(seats.map((seat) => seat.section))];
  // Earlier sections are better and more popular: weights 5, 4, 3, 2, 1, 1, ...
  const weights = sections.map((name) => Math.max(1, 5 - order.indexOf(name)));
  const section = sections[weightedIndex(weights, random)] ?? sections[0];

  const inSection = free.filter((seat) => seat.section === section);
  const start = inSection[Math.floor(random() * inSection.length)];
  if (!start) return [];

  // Grow a run of adjacent free seats in the same row, to the right first, then to the left.
  const row = new Map(
    free
      .filter((s) => s.section === start.section && s.row === start.row)
      .map((s) => [s.number, s]),
  );
  const picked = [start];
  for (let n = start.number + 1; picked.length < wanted && row.has(n); n++) {
    const seat = row.get(n);
    if (seat) picked.push(seat);
  }
  for (let n = start.number - 1; picked.length < wanted && row.has(n); n--) {
    const seat = row.get(n);
    if (seat) picked.unshift(seat);
  }
  return picked.map((seat) => seat.id);
}

/** Party size: mostly pairs, some singles and groups. */
export function partySize(random: () => number, max: number): number {
  const sizes = [1, 2, 2, 2, 3, 4];
  return Math.min(max, sizes[Math.floor(random() * sizes.length)] ?? 2);
}

function weightedIndex(weights: number[], random: () => number): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let target = random() * total;
  for (let i = 0; i < weights.length; i++) {
    target -= weights[i] ?? 0;
    if (target < 0) return i;
  }
  return weights.length - 1;
}
