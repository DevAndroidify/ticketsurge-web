/** Shapes shared by the live backend client, the in-browser simulation, and the UI. */

export type Mode = 'live' | 'simulated';

export type SeatStatus = 'available' | 'held' | 'sold';

export interface Seat {
  id: string;
  section: string;
  row: string;
  number: number;
  priceMinor: number;
  status: SeatStatus;
}

export interface SeatMap {
  eventId: string;
  seats: Seat[];
  /** True when Redis was unreachable and unbooked holds are not visible. */
  degraded: boolean;
}

export interface SaleEvent {
  id: string;
  name: string;
  venue: string;
  totalSeats: number;
}

export type BookingStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';

// ---------- Infrastructure ----------

export type ComponentState = 'up' | 'down' | 'starting' | 'unknown';

export interface ComponentStatus {
  id: string;
  label: string;
  kind: 'container' | 'service';
  state: ComponentState;
  /** Shown under the name, e.g. "postgres:18 · 3 ms". */
  detail?: string;
}

// ---------- Metrics ----------

/** One sample of everything the dashboard plots. Rates are per second. */
export interface MetricsSnapshot {
  at: number;
  http: {
    total: number;
    ok: number;
    /** 409: seat taken, hold gone. The guarantee doing its job. */
    conflict: number;
    rateLimited: number;
    /** Other 4xx, e.g. 403 not admitted yet. */
    clientError: number;
    serverError: number;
  };
  /** p95 latency in milliseconds per route, e.g. "POST /events/:id/holds". */
  p95Ms: Record<string, number>;
  /** Kafka messages processed per second, by consumer group. */
  consumed: Record<string, number>;
  /** Kafka consumer lag, by consumer group. */
  lag: Record<string, number>;
  outboxBacklog: number;
  outboxPublished: number;
  queueWaiting: number;
  admitted: number;
  wsForwarded: number;
  wsConnections: number;
}

export const CONSUMER_GROUPS = [
  'payment-service',
  'booking-saga',
  'seat-sync',
  'ticket-service',
  'notification-service',
  'analytics',
] as const;

export function emptySnapshot(at: number): MetricsSnapshot {
  return {
    at,
    http: { total: 0, ok: 0, conflict: 0, rateLimited: 0, clientError: 0, serverError: 0 },
    p95Ms: {},
    consumed: {},
    lag: {},
    outboxBacklog: 0,
    outboxPublished: 0,
    queueWaiting: 0,
    admitted: 0,
    wsForwarded: 0,
    wsConnections: 0,
  };
}
