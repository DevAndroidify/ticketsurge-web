import type {
  BookingStatus,
  ComponentStatus,
  MetricsSnapshot,
  Mode,
  SaleEvent,
  SeatMap,
  SeatStatus,
} from './types';

/** A signed-in user. Bots and the dashboard's own socket each have one. */
export interface Session {
  userId: string;
  email: string;
  token: string;
}

export interface QueueStatus {
  admitted: boolean;
  position: number;
}

/**
 * Every call reports the HTTP outcome instead of throwing, because 409s and 429s are expected.
 * `http` is the status code, or 0 when the request never got an answer.
 */
export type Outcome<T> =
  | ({ ok: true; http: number } & T)
  | { ok: false; http: number; code: string; message: string; retryAfterMs?: number };

/** Simulated mode only: stop and start components to show how the system copes. */
export interface Chaos {
  readonly stoppable: readonly string[];
  isStopped(id: string): boolean;
  setStopped(id: string, stopped: boolean): void;
}

export interface SeatsUpdated {
  seatIds: string[];
  status: SeatStatus;
}

export type SocketState = 'connecting' | 'open' | 'closed';

export interface SaleOptions {
  sections: number;
  rows: number;
  seatsPerRow: number;
}

export const SECTION_NAMES = ['Floor', 'Lower Bowl', 'Upper Bowl', 'Balcony', 'Gallery'];
export const SECTION_PRICES_MINOR = [15000, 9500, 6500, 4000, 2500];
export const ROW_LABELS = 'ABCDEFGHJKLMNPQRSTUV'.split('');

/**
 * The backend as the dashboard sees it. LiveBackend talks to the real services through the dev
 * server's proxy; SimBackend runs a small model of them in the browser.
 */
export interface Backend {
  readonly mode: Mode;
  readonly chaos?: Chaos;

  components(): Promise<ComponentStatus[]>;
  metrics(): Promise<MetricsSnapshot>;

  /** Creates a fresh event for a sale run, or reuses one when that is not possible. */
  prepareSale(options: SaleOptions): Promise<SaleEvent>;
  seats(eventId: string): Promise<SeatMap>;

  createUser(label: string): Promise<Outcome<{ session: Session }>>;
  joinQueue(session: Session, eventId: string): Promise<Outcome<QueueStatus>>;
  queueStatus(session: Session, eventId: string): Promise<Outcome<QueueStatus>>;
  hold(
    session: Session,
    eventId: string,
    seatIds: string[],
  ): Promise<Outcome<{ holdId: string; expiresAt: string }>>;
  releaseHold(session: Session, holdId: string): Promise<Outcome<object>>;
  book(
    session: Session,
    holdId: string,
    idempotencyKey: string,
  ): Promise<Outcome<{ bookingId: string; status: BookingStatus }>>;
  booking(session: Session, bookingId: string): Promise<Outcome<{ status: BookingStatus }>>;

  /** Live seat changes for one event. Returns an unsubscribe function. */
  subscribeSeats(
    session: Session,
    eventId: string,
    onUpdate: (update: SeatsUpdated) => void,
    onState: (state: SocketState) => void,
  ): () => void;

  dispose(): void;
}
