/** Rates: one decimal below 10, whole numbers above. */
export function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString('en-US');
}

export function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function formatMs(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '–';
  if (value < 1) return '<1 ms';
  return value < 100 ? `${value.toFixed(1)} ms` : `${Math.round(value)} ms`;
}

export function formatMoney(minor: number): string {
  return (minor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
