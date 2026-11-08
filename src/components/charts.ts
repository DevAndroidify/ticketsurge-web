/** Pure helpers for the hand-drawn SVG charts, kept separate so they can be unit tested. */

export interface Point {
  x: number;
  y: number;
}

/** A smooth path through points (monotone in x), using Catmull-Rom converted to Béziers. */
export function smoothLine(points: Point[]): string {
  const first = points[0];
  if (!first) return '';
  let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** Closed area between an upper line and a lower line (for stacking). */
export function smoothArea(upper: Point[], lower: Point[]): string {
  if (upper.length === 0) return '';
  const top = smoothLine(upper);
  const bottom = smoothLine([...lower].reverse()).replace(/^M/, 'L');
  return `${top} ${bottom} Z`;
}

/** A "nice" axis maximum: 1, 2, 5 × 10^n, at least `floor`. */
export function niceMax(value: number, floor = 5): number {
  const v = Math.max(value, floor);
  const magnitude = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (v <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/** Cumulative sums per sample: stack[i][k] is the top of series k at sample i. */
export function stack(series: number[][]): number[][] {
  return series.map((values) => {
    let running = 0;
    return values.map((v) => (running += Math.max(0, v)));
  });
}

/**
 * Particles per second for an edge of the flow diagram. Busy edges look busy without drowning the
 * picture: one particle per message up to 6/s, then logarithmic, capped at 20/s.
 */
export function visualRate(rate: number): number {
  if (!(rate > 0)) return 0;
  if (rate <= 6) return Math.max(rate, 0.6);
  return Math.min(20, 6 + Math.log2(1 + rate - 6) * 2.5);
}
