import {
  ROW_LABELS,
  SECTION_NAMES,
  SECTION_PRICES_MINOR,
  type Backend,
  type Outcome,
  type QueueStatus,
  type SaleOptions,
  type SeatsUpdated,
  type Session,
  type SocketState,
} from '../backend';
import type {
  BookingStatus,
  ComponentState,
  ComponentStatus,
  MetricsSnapshot,
  SaleEvent,
  Seat,
  SeatMap,
  SeatStatus,
} from '../types';
import { emptySnapshot } from '../types';
import { reachable, request } from './http';
import { QUERIES, query, toSnapshot, type QueryResults, type Sample } from './prometheus';

interface HealthBody {
  checks?: Record<string, { status?: string; latencyMs?: number; error?: string }>;
}

interface AuthBody {
  user: { id: string; email: string };
  accessToken: string;
}

interface EventBody {
  id: string;
  name: string;
  venue: string;
  status: string;
  saleStartsAt: string;
  totalSeats: number;
}

/** Node services scraped by Prometheus, in the order the dashboard lists them. */
const SERVICES = [
  ['api', 'API'],
  ['realtime-gateway', 'Realtime gateway'],
  ['admission-worker', 'Admission worker'],
  ['booking-worker', 'Booking worker'],
  ['payment-service', 'Payment service'],
  ['ticket-service', 'Ticket service'],
  ['notification-service', 'Notification service'],
  ['analytics-service', 'Analytics service'],
] as const;

/** Talks to the real backend through the Vite proxy: /api, /ws, /prom, /grafana, /kafka-ui. */
export class LiveBackend implements Backend {
  readonly mode = 'live' as const;
  /** Makes bot emails unique per page load, so reruns never hit EMAIL_TAKEN. */
  private readonly runTag = Date.now().toString(36);

  async components(): Promise<ComponentStatus[]> {
    const [checks, up, prometheus, grafana, kafkaUi] = await Promise.all([
      apiHealth(),
      query('up').catch(() => undefined),
      reachable('/prom/-/ready'),
      reachable('/grafana/api/health'),
      reachable('/kafka-ui/actuator/health'),
    ]);

    // The API checks PostgreSQL, Redis and Kafka itself; without it their state is unknown.
    const apiAnswered = checks !== undefined;
    const fromCheck = (name: string, label: string, image: string): ComponentStatus => {
      const check = checks?.[name];
      if (!check) {
        return { id: name, label, kind: 'container', state: 'unknown', detail: 'needs the API' };
      }
      const state: ComponentState = check.status === 'up' ? 'up' : 'down';
      const latency = check.latencyMs === undefined ? '' : ` · ${Math.round(check.latencyMs)} ms`;
      return { id: name, label, kind: 'container', state, detail: `${image}${latency}` };
    };

    const upBy = (job: string, app?: string) => upState(up, job, app);
    return [
      fromCheck('postgres', 'PostgreSQL', 'postgres:18'),
      fromCheck('redis', 'Redis', 'redis:8'),
      fromCheck('kafka', 'Kafka (KRaft)', 'apache/kafka:4'),
      container('kafka-ui', 'Kafka UI', kafkaUi, 'kafbat/kafka-ui'),
      {
        id: 'kafka-exporter',
        label: 'Kafka exporter',
        kind: 'container',
        state: upBy('kafka-exporter'),
        detail: 'consumer lag → Prometheus',
      },
      container('prometheus', 'Prometheus', prometheus, 'scrapes every 5 s'),
      container('grafana', 'Grafana', grafana, 'dashboards'),
      ...SERVICES.map(([id, label]): ComponentStatus => {
        const state = id === 'api' ? (apiAnswered ? 'up' : 'down') : upBy('ticketsurge', id);
        return { id, label, kind: 'service', state };
      }),
    ];
  }

  async metrics(): Promise<MetricsSnapshot> {
    const at = Date.now();
    const keys = Object.keys(QUERIES) as (keyof typeof QUERIES)[];
    try {
      const values = await Promise.all(keys.map((key) => query(QUERIES[key])));
      const results = Object.fromEntries(keys.map((key, i) => [key, values[i]])) as QueryResults;
      return toSnapshot(results, at);
    } catch {
      return emptySnapshot(at);
    }
  }

  async prepareSale(options: SaleOptions): Promise<SaleEvent> {
    if (options.admin?.email && options.admin.password) {
      const admin = await this.signIn(options.admin.email, options.admin.password);
      const now = Date.now();
      const created = await request<EventBody>('POST', '/admin/events', {
        token: admin.token,
        body: {
          name: `Flash sale ${new Date(now).toLocaleTimeString()}`,
          venue: 'Demo Arena',
          startsAt: new Date(now + 7 * 24 * 3600_000).toISOString(),
          saleStartsAt: new Date(now - 60_000).toISOString(),
          status: 'PUBLISHED',
          sections: Array.from({ length: options.sections }, (_, i) => ({
            name: SECTION_NAMES[i] ?? `Section ${i + 1}`,
            priceMinor: SECTION_PRICES_MINOR[i] ?? 2000,
            rows: ROW_LABELS.slice(0, options.rows),
            seatsPerRow: options.seatsPerRow,
          })),
        },
      });
      if (!created.ok) {
        throw new Error(
          created.http === 403
            ? `${options.admin.email} is not in the backend's ADMIN_EMAILS`
            : `Could not create the event: ${created.message}`,
        );
      }
      return pickEvent(created);
    }
    return this.reuseOpenEvent();
  }

  async seats(eventId: string): Promise<SeatMap> {
    const result = await request<{ seats: Seat[]; degraded: boolean }>(
      'GET',
      `/events/${eventId}/seats`,
    );
    if (!result.ok) throw new Error(`Seat map unavailable: ${result.message}`);
    return { eventId, seats: result.seats, degraded: result.degraded };
  }

  async createUser(label: string): Promise<Outcome<{ session: Session }>> {
    const email = `bot-${this.runTag}-${label}@demo.ticketsurge.test`;
    const result = await request<AuthBody>('POST', '/auth/register', {
      body: { email, password: crypto.randomUUID() },
    });
    if (!result.ok) return result;
    return { ok: true, http: result.http, session: toSession(result) };
  }

  async joinQueue(session: Session, eventId: string): Promise<Outcome<QueueStatus>> {
    return request<QueueStatus>('POST', `/events/${eventId}/queue`, { token: session.token });
  }

  async queueStatus(session: Session, eventId: string): Promise<Outcome<QueueStatus>> {
    return request<QueueStatus>('GET', `/events/${eventId}/queue/me`, { token: session.token });
  }

  async hold(session: Session, eventId: string, seatIds: string[]) {
    return request<{ holdId: string; expiresAt: string }>('POST', `/events/${eventId}/holds`, {
      token: session.token,
      body: { seatIds },
    });
  }

  async releaseHold(session: Session, holdId: string) {
    return request<object>('DELETE', `/holds/${holdId}`, { token: session.token });
  }

  async book(session: Session, holdId: string, idempotencyKey: string) {
    return request<{ bookingId: string; status: BookingStatus }>('POST', '/bookings', {
      token: session.token,
      body: { holdId },
      headers: { 'idempotency-key': idempotencyKey },
    });
  }

  async booking(session: Session, bookingId: string) {
    return request<{ status: BookingStatus }>('GET', `/bookings/${bookingId}`, {
      token: session.token,
    });
  }

  /**
   * WebSocket through the proxy. Redis Pub/Sub keeps no history, so the caller reloads the seat
   * map whenever this reports `open` again after a drop.
   */
  subscribeSeats(
    session: Session,
    eventId: string,
    onUpdate: (update: SeatsUpdated) => void,
    onState: (state: SocketState) => void,
  ): () => void {
    let socket: WebSocket | undefined;
    let stopped = false;
    let retryMs = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      onState('connecting');
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(
        `${scheme}://${location.host}/ws?token=${encodeURIComponent(session.token)}`,
      );
      socket.onopen = () => {
        retryMs = 1000;
        socket?.send(JSON.stringify({ type: 'subscribe.event', eventId }));
        onState('open');
      };
      socket.onmessage = (message: MessageEvent<string>) => {
        const data = safeParse(message.data);
        if (data?.type === 'seats.updated' && data.eventId === eventId) {
          onUpdate({ seatIds: data.seatIds, status: data.status });
        }
      };
      socket.onclose = () => {
        onState('closed');
        if (stopped) return;
        timer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 8000);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }

  dispose(): void {
    // Nothing global to release; sockets are closed by their unsubscribe functions.
  }

  private async signIn(email: string, password: string): Promise<Session> {
    const login = await request<AuthBody>('POST', '/auth/login', { body: { email, password } });
    if (login.ok) return toSession(login);
    if (login.http !== 401) throw new Error(`Admin sign-in failed: ${login.message}`);

    const registered = await request<AuthBody>('POST', '/auth/register', {
      body: { email, password },
    });
    if (registered.ok) return toSession(registered);
    throw new Error(
      registered.http === 409
        ? `${email} exists with a different password`
        : `Admin sign-up failed: ${registered.message}`,
    );
  }

  private async reuseOpenEvent(): Promise<SaleEvent> {
    const list = await request<{ events: EventBody[] }>('GET', '/events?limit=100');
    if (!list.ok) throw new Error(`Cannot list events: ${list.message}`);
    const open = list.events
      .filter((e) => e.status === 'PUBLISHED' && Date.parse(e.saleStartsAt) <= Date.now())
      .reverse();
    for (const event of open) {
      const map = await this.seats(event.id);
      if (map.seats.some((seat) => seat.status === 'available')) return pickEvent(event);
    }
    throw new Error(
      'No event on sale has free seats. Add admin credentials to create one, or run npm run db:seed.',
    );
  }
}

/**
 * GET /health answers 200 when every dependency is up and 503 with the same per-dependency body
 * when one is down. Anything else (proxy error, timeout) means the API itself is not running.
 */
async function apiHealth(): Promise<HealthBody['checks']> {
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
    if (response.status !== 200 && response.status !== 503) return undefined;
    const body = (await response.json()) as HealthBody;
    return body.checks;
  } catch {
    return undefined;
  }
}

/** True when the dev server's proxy reaches the API. Used to choose live or simulated mode. */
export async function liveBackendAvailable(): Promise<boolean> {
  return (await apiHealth()) !== undefined;
}

function container(id: string, label: string, ok: boolean, detail: string): ComponentStatus {
  return { id, label, kind: 'container', state: ok ? 'up' : 'down', detail };
}

/** A service with several scrape targets counts as up when any instance is. */
function upState(samples: Sample[] | undefined, job: string, app?: string): ComponentState {
  if (!samples) return 'unknown';
  const matching = samples.filter(
    (s) => s.labels.job === job && (app === undefined || s.labels.app === app),
  );
  if (matching.length === 0) return 'unknown';
  return matching.some((s) => s.value === 1) ? 'up' : 'down';
}

function toSession(body: AuthBody): Session {
  return { userId: body.user.id, email: body.user.email, token: body.accessToken };
}

function pickEvent(event: EventBody): SaleEvent {
  return { id: event.id, name: event.name, venue: event.venue, totalSeats: event.totalSeats };
}

interface SeatsMessage {
  type?: string;
  eventId?: string;
  seatIds: string[];
  status: SeatStatus;
}

function safeParse(raw: string): SeatsMessage | undefined {
  try {
    return JSON.parse(raw) as SeatsMessage;
  } catch {
    return undefined;
  }
}
