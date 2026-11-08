import { describe, expect, it } from 'vitest';
import type { Seat, SeatStatus } from '../types';
import { partySize, pickSeats } from './seat-picker';

function row(section: string, statuses: SeatStatus[]): Seat[] {
  return statuses.map((status, i) => ({
    id: `${section}-${i + 1}`,
    section,
    row: 'A',
    number: i + 1,
    priceMinor: 1000,
    status,
  }));
}

const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

describe('pickSeats', () => {
  it('only picks available seats', () => {
    const seats = row('Floor', ['sold', 'held', 'available', 'sold']);
    expect(pickSeats(seats, 2, sequence(0, 0))).toEqual(['Floor-3']);
  });

  it('picks adjacent seats in the same row', () => {
    const seats = row('Floor', ['available', 'available', 'available', 'available']);
    const picked = pickSeats(seats, 3, sequence(0, 0.3));
    expect(picked).toHaveLength(3);
    const numbers = picked.map((id) => Number(id.split('-')[1])).sort((a, b) => a - b);
    expect(numbers).toHaveLength(3);
    expect((numbers[2] ?? 0) - (numbers[0] ?? 0)).toBe(2);
  });

  it('returns nothing when the event is sold out', () => {
    expect(pickSeats(row('Floor', ['sold', 'held']), 2, Math.random)).toEqual([]);
  });

  it('prefers the first (best) section', () => {
    const seats = [
      ...row('Floor', Array<SeatStatus>(10).fill('available')),
      ...row('Balcony', Array<SeatStatus>(10).fill('available')),
    ];
    let floor = 0;
    let random = 0;
    const next = () => (random = (random * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 500; i++) if (pickSeats(seats, 1, next)[0]?.startsWith('Floor')) floor++;
    expect(floor).toBeGreaterThan(250);
  });
});

describe('partySize', () => {
  it('stays within the per-hold limit', () => {
    for (let i = 0; i < 6; i++) {
      expect(partySize(() => i / 6, 3)).toBeLessThanOrEqual(3);
    }
  });
});
