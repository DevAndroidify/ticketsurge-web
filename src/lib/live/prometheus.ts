import { emptySnapshot, type MetricsSnapshot } from '../types';

export interface Sample {
  labels: Record<string, string>;
  value: number;
}

interface VectorResponse {
  status?: string;
  data?: { resultType?: string; result?: { metric?: Record<string, string>; value?: unknown }[] };
}

/** Parses an instant-query response. NaN and Inf (e.g. a quantile with no traffic) are dropped. */
export function parseVector(body: unknown): Sample[] {
  const response = (body ?? {}) as VectorResponse;
  if (response.status !== 'success' || response.data?.resultType !== 'vector') return [];
  const samples: Sample[] = [];
  for (const item of response.data.result ?? []) {
    const raw = Array.isArray(item.value) ? (item.value[1] as unknown) : undefined;
    const value = typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(value)) samples.push({ labels: item.metric ?? {}, value });
  }
  return samples;
}

export async function query(expr: string): Promise<Sample[]> {
  const response = await fetch(`/prom/api/v1/query?query=${encodeURIComponent(expr)}`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Prometheus answered ${response.status}`);
  return parseVector(await response.json());
}

// Prometheus scrapes every 5 s (infra/prometheus/prometheus.yml), so a 20 s window holds four
// samples: short enough to react within a few seconds, long enough not to flicker.
const WINDOW = '20s';
const NOT_INTERNAL = 'route!="/metrics",route!="/health"';
const LATENCY_ROUTES = 'route=~"/events/:id/queue|/events/:id/holds|/bookings"';

export const QUERIES = {
  status: `sum by (status) (rate(ticketsurge_http_requests_total{${NOT_INTERNAL}}[${WINDOW}]))`,
  p95: `histogram_quantile(0.95, sum by (le, method, route) (rate(ticketsurge_http_request_duration_seconds_bucket{${LATENCY_ROUTES}}[30s])))`,
  consumed: `sum by (group) (rate(ticketsurge_messages_total[${WINDOW}]))`,
  lag: 'sum by (consumergroup) (clamp_min(kafka_consumergroup_lag{consumergroup!~"test.*"}, 0))',
  // Several booking-worker instances can report the same table, so take the max per table.
  outboxBacklog: 'sum(max by (table) (ticketsurge_outbox_backlog))',
  outboxPublished: `sum(rate(ticketsurge_outbox_published_total[${WINDOW}]))`,
  queueWaiting: 'sum(ticketsurge_queue_waiting_users)',
  admitted: `sum(rate(ticketsurge_admitted_users_total[${WINDOW}]))`,
  wsForwarded: `sum(rate(ticketsurge_ws_messages_forwarded_total[${WINDOW}]))`,
  wsConnections: 'sum(ticketsurge_ws_connections)',
} as const;

export type QueryResults = Record<keyof typeof QUERIES, Sample[]>;

const scalar = (samples: Sample[]) => samples[0]?.value ?? 0;

const byLabel = (samples: Sample[], label: string) =>
  Object.fromEntries(samples.map((s) => [s.labels[label] ?? '?', s.value]));

/** Folds the raw query results into the dashboard's snapshot shape. */
export function toSnapshot(results: QueryResults, at: number): MetricsSnapshot {
  const snapshot = emptySnapshot(at);
  for (const { labels, value } of results.status) {
    const code = Number(labels.status);
    snapshot.http.total += value;
    if (code === 409) snapshot.http.conflict += value;
    else if (code === 429) snapshot.http.rateLimited += value;
    else if (code >= 500) snapshot.http.serverError += value;
    else if (code >= 400) snapshot.http.clientError += value;
    else snapshot.http.ok += value;
  }
  for (const { labels, value } of results.p95) {
    snapshot.p95Ms[`${labels.method ?? ''} ${labels.route ?? ''}`.trim()] = value * 1000;
  }
  snapshot.consumed = byLabel(results.consumed, 'group');
  snapshot.lag = byLabel(results.lag, 'consumergroup');
  snapshot.outboxBacklog = scalar(results.outboxBacklog);
  snapshot.outboxPublished = scalar(results.outboxPublished);
  snapshot.queueWaiting = scalar(results.queueWaiting);
  snapshot.admitted = scalar(results.admitted);
  snapshot.wsForwarded = scalar(results.wsForwarded);
  snapshot.wsConnections = scalar(results.wsConnections);
  return snapshot;
}
