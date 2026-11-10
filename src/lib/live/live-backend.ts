import type { Backend, Outcome, QueueStatus, SeatsUpdated, Session, SocketState } from '../backend';
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
import type { Endpoints } from './endpoints';
import { reachable, request, type RequestOptions } from './http';
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

/**
 * Talks to the real backend, either through the Vite proxy (run locally) or straight to the
 * visitor's localhost ("Connect my backend" on a hosted copy). See endpoints.ts.
 */
export class LiveBackend implements Backend {
  readonly mode = 'live' as const;
  /** Makes bot emails unique per page load, so reruns never hit EMAIL_TAKEN. */
  private readonly runTag = Date.now().toString(36);

  constructor(readonly endpoints: Endpoints) {}

  private call<T extends object>(method: string, path: string, options?: RequestOptions) {
    return request<T>(method, `${this.endpoints.api}${path}`, options);
  }

  async components(): Promise<ComponentStatus[]> {
    // Grafana, Kafka UI and Prometheus's /-/ready send no CORS headers (Prometheus allows other
    // origins only on its query API), so a direct check can only see that they answer.
    const opaque = this.endpoints.kind === 'direct';
    const [checks, up, prometheus, grafana, kafkaUi] = await Promise.all([
      apiHealth(this.endpoints.api),
      query(this.endpoints.prometheus, 'up').catch(() => undefined),
      reachable(`${this.endpoints.prometheus}/-/ready`, opaque),
      reachable(this.endpoints.grafanaHealth, opaque),
      reachable(this.endpoints.kafkaUiHealth, opaque),
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
      const values = await Promise.all(
        keys.map((key) => query(this.endpoints.prometheus, QUERIES[key])),
      );
      const results = Object.fromEntries(keys.map((key, i) => [key, values[i]])) as QueryResults;
      return toSnapshot(results, at);
    } catch {
      return emptySnapshot(at);
    }
  }

  /**
   * Sells from the event on sale with the most free seats (the newest wins a tie): the seeded
   * demo event, or one opened with `npm run demo:new-event`. Most free seats, not just any, so a
   * crowd is not sent at a leftover event with a handful of seats. The page never creates events,
   * because that needs an admin account, and no admin credentials belong in a browser. The layout
   * options only apply to the simulation.
   */
  async prepareSale(): Promise<SaleEvent> {
    const list = await this.call<{ events: EventBody[] }>('GET', '/events?limit=100');
    if (!list.ok) throw new Error(`Cannot list events: ${list.message}`);
    const open = list.events
      .filter((e) => e.status === 'PUBLISHED' && Date.parse(e.saleStartsAt) <= Date.now())
      .reverse()
      .slice(0, 12);
    const free = await Promise.all(
      open.map(async (event) => {
        const map = await this.seats(event.id).catch(() => undefined);
        return map?.seats.filter((seat) => seat.status === 'available').length ?? 0;
      }),
    );
    let best = -1;
    free.forEach((count, i) => {
      if (count > 0 && (best < 0 || count > (free[best] ?? 0))) best = i;
    });
    const chosen = open[best];
    if (chosen) return pickEvent(chosen);
    throw new Error(
      open.length === 0
        ? 'No event is on sale yet. In the backend, run npm run db:seed, then try again.'
        : 'Every event on sale is sold out. In the backend, run npm run demo:new-event, then try again.',
    );
  }

  async seats(eventId: string): Promise<SeatMap> {
    const result = await this.call<{ seats: Seat[]; degraded: boolean }>(
      'GET',
      `/events/${eventId}/seats`,
    );
    if (!result.ok) throw new Error(`Seat map unavailable: ${result.message}`);
    return { eventId, seats: result.seats, degraded: result.degraded };
  }

  async createUser(label: string): Promise<Outcome<{ session: Session }>> {
    const email = `bot-${this.runTag}-${label}@demo.ticketsurge.test`;
    const result = await this.call<AuthBody>('POST', '/auth/register', {
      body: { email, password: crypto.randomUUID() },
    });
    if (!result.ok) return result;
    return { ok: true, http: result.http, session: toSession(result) };
  }

  async joinQueue(session: Session, eventId: string): Promise<Outcome<QueueStatus>> {
    return this.call<QueueStatus>('POST', `/events/${eventId}/queue`, { token: session.token });
  }

  async queueStatus(session: Session, eventId: string): Promise<Outcome<QueueStatus>> {
    return this.call<QueueStatus>('GET', `/events/${eventId}/queue/me`, { token: session.token });
  }

  async hold(session: Session, eventId: string, seatIds: string[]) {
    return this.call<{ holdId: string; expiresAt: string }>('POST', `/events/${eventId}/holds`, {
      token: session.token,
      body: { seatIds },
    });
  }

  async releaseHold(session: Session, holdId: string) {
    return this.call<object>('DELETE', `/holds/${holdId}`, { token: session.token });
  }

  async book(session: Session, holdId: string, idempotencyKey: string) {
    return this.call<{ bookingId: string; status: BookingStatus }>('POST', '/bookings', {
      token: session.token,
      body: { holdId },
      headers: { 'idempotency-key': idempotencyKey },
    });
  }

  async booking(session: Session, bookingId: string) {
    return this.call<{ status: BookingStatus }>('GET', `/bookings/${bookingId}`, {
      token: session.token,
    });
  }

  /**
   * WebSocket to the realtime gateway. Redis Pub/Sub keeps no history, so the caller reloads the seat
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
      socket = new WebSocket(`${this.endpoints.ws}?token=${encodeURIComponent(session.token)}`);
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
}

/**
 * GET /health answers 200 when every dependency is up and 503 with the same per-dependency body
 * when one is down. Anything else (proxy error, timeout, CORS) means the API is not reachable.
 */
async function apiHealth(api: string): Promise<HealthBody['checks']> {
  try {
    const response = await fetch(`${api}/health`, { signal: AbortSignal.timeout(3000) });
    if (response.status !== 200 && response.status !== 503) return undefined;
    const body = (await response.json()) as HealthBody;
    return body.checks;
  } catch {
    return undefined;
  }
}

/** True when the API answers at these endpoints. Used to choose live or simulated mode. */
export async function liveBackendAvailable(endpoints: Endpoints): Promise<boolean> {
  return (await apiHealth(endpoints.api)) !== undefined;
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
