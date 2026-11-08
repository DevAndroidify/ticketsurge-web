import { describe, expect, it } from 'vitest';
import { parseVector, QUERIES, toSnapshot, type QueryResults, type Sample } from './prometheus';

const vector = (result: { metric: Record<string, string>; value: [number, string] }[]) => ({
  status: 'success',
  data: { resultType: 'vector', result },
});

describe('parseVector', () => {
  it('reads labels and values', () => {
    const samples = parseVector(vector([{ metric: { status: '200' }, value: [1, '12.5'] }]));
    expect(samples).toEqual([{ labels: { status: '200' }, value: 12.5 }]);
  });

  it('drops NaN and infinite values, e.g. a quantile with no traffic', () => {
    const samples = parseVector(
      vector([
        { metric: { route: 'a' }, value: [1, 'NaN'] },
        { metric: { route: 'b' }, value: [1, '+Inf'] },
        { metric: { route: 'c' }, value: [1, '3'] },
      ]),
    );
    expect(samples.map((s) => s.labels.route)).toEqual(['c']);
  });

  it('returns nothing for errors and non-vector results', () => {
    expect(parseVector({ status: 'error' })).toEqual([]);
    expect(parseVector({ status: 'success', data: { resultType: 'matrix', result: [] } })).toEqual(
      [],
    );
    expect(parseVector(undefined)).toEqual([]);
  });
});

describe('toSnapshot', () => {
  const empty = Object.fromEntries(
    Object.keys(QUERIES).map((k) => [k, [] as Sample[]]),
  ) as QueryResults;

  it('groups HTTP rates by outcome', () => {
    const results = {
      ...empty,
      status: [
        { labels: { status: '201' }, value: 10 },
        { labels: { status: '200' }, value: 5 },
        { labels: { status: '409' }, value: 3 },
        { labels: { status: '429' }, value: 2 },
        { labels: { status: '403' }, value: 1 },
        { labels: { status: '503' }, value: 0.5 },
      ],
    };
    const { http } = toSnapshot(results, 0);
    expect(http).toEqual({
      total: 21.5,
      ok: 15,
      conflict: 3,
      rateLimited: 2,
      clientError: 1,
      serverError: 0.5,
    });
  });

  it('keys latency by method and route, in milliseconds', () => {
    const results = {
      ...empty,
      p95: [{ labels: { method: 'POST', route: '/bookings' }, value: 0.012 }],
      lag: [{ labels: { consumergroup: 'payment-service' }, value: 42 }],
    };
    const snapshot = toSnapshot(results, 0);
    expect(snapshot.p95Ms['POST /bookings']).toBeCloseTo(12);
    expect(snapshot.lag['payment-service']).toBe(42);
  });
});
