import { describe, expect, it } from 'vitest';
import { niceMax, smoothLine, stack, visualRate } from './charts';

describe('chart helpers', () => {
  it('rounds axis maxima up to 1, 2, 2.5 or 5 × 10^n', () => {
    expect(niceMax(3)).toBe(5);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(240)).toBe(250);
    expect(niceMax(4100)).toBe(5000);
  });

  it('stacks series cumulatively and ignores negatives', () => {
    expect(stack([[1, 2, -1, 3]])).toEqual([[1, 3, 3, 6]]);
  });

  it('draws nothing for no points and one curve per gap otherwise', () => {
    expect(smoothLine([])).toBe('');
    const d = smoothLine([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
    ]);
    expect(d.startsWith('M 0.0 0.0')).toBe(true);
    expect(d.match(/C /g)).toHaveLength(2);
  });

  it('caps particle rates so busy edges stay readable', () => {
    expect(visualRate(0)).toBe(0);
    expect(visualRate(Number.NaN)).toBe(0);
    expect(visualRate(3)).toBe(3);
    expect(visualRate(10_000)).toBe(20);
  });
});
