import { memo } from 'react';
import type { SocketState } from '../lib/backend';
import type { SaleEvent, SeatStatus } from '../lib/types';
import type { SeatCell } from '../state/dashboard';

/** The visitor's part in the map. Everything is empty when they are not buying. */
export interface SeatPicking {
  /** True while seats can be clicked. */
  active: boolean;
  selected: ReadonlySet<string>;
  mine: ReadonlySet<string>;
  onToggle: (seatId: string) => void;
}

const SEAT_LOOK: Record<SeatStatus, string> = {
  available: 'bg-accent',
  held: 'seat-held',
  sold: 'bg-sold',
};

/** "Tonight's venue": the stage, each section with its price and seats left, and the legend. */
export function SeatMap({
  event,
  seats,
  socket,
  degraded,
  picking,
}: {
  event?: SaleEvent;
  seats: SeatCell[];
  socket: SocketState;
  degraded: boolean;
  picking: SeatPicking;
}) {
  const sections = groupBy(seats, (s) => s.section);
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h2 className="m-0 text-[22px] font-semibold">Tonight&apos;s venue</h2>
          <p className="mt-1 text-sm text-muted">
            {event ? `${event.name}. ${socketText(socket)}` : 'Empty until a sale starts.'}
            {degraded && ' Redis is down, so held seats show as open for now.'}
          </p>
        </div>
        <Legend />
      </div>

      {picking.active && (
        <p className="m-0 text-[15px] font-medium">Your turn. Click up to 4 open seats.</p>
      )}

      <div className="w-[min(620px,100%)] self-center border border-ink p-2 text-center text-xs font-semibold tracking-[0.5em]">
        STAGE
      </div>

      {seats.length === 0 ? (
        <div className="grid h-48 place-items-center border border-dashed border-line px-4 text-center text-[15px] text-muted">
          The house is empty. Start a sale, or get a ticket yourself.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-9 gap-y-7">
          {[...sections].map(([name, list]) => (
            <Section key={name} name={name} seats={list} picking={picking} />
          ))}
        </div>
      )}
    </div>
  );
}

function socketText(socket: SocketState): string {
  if (socket === 'open') return 'Seats change live over WebSocket.';
  if (socket === 'connecting') return 'Connecting to live updates…';
  return 'Live updates paused; the map reloads every few seconds.';
}

export function Legend() {
  return (
    <div className="flex flex-wrap gap-[18px] text-sm text-muted">
      <span className="flex items-center gap-2">
        <span className="size-3 bg-accent" />
        Open
      </span>
      <span className="flex items-center gap-2">
        <span className="seat-held size-3" />
        Held
      </span>
      <span className="flex items-center gap-2">
        <span className="size-3 bg-sold" />
        Sold
      </span>
    </div>
  );
}

const Section = memo(function Section({
  name,
  seats,
  picking,
}: {
  name: string;
  seats: SeatCell[];
  picking: SeatPicking;
}) {
  const rows = groupBy(seats, (s) => s.row);
  const left = seats.filter((s) => s.status === 'available').length;
  const sold = seats.filter((s) => s.status === 'sold').length;
  const price = seats[0]?.priceMinor ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-base font-semibold">{name}</span>
          <span className="text-sm text-muted tabular">
            ${Math.round(price / 100)} · {left} left
          </span>
        </div>
        {/* The section's hairline doubles as how full it is: ink for sold. */}
        <div role="img" aria-label={`${sold} of ${seats.length} sold`} className="h-px bg-line">
          <div
            className="h-px bg-ink transition-[width] duration-500"
            style={{ width: `${seats.length ? (sold / seats.length) * 100 : 0}%` }}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {[...rows].map(([row, list]) => (
          <div key={row} className="flex items-center gap-1">
            <span className="w-3.5 flex-none text-[11px] font-semibold text-muted">{row}</span>
            {list.map((seat) => (
              <SeatSquare key={`${seat.id}:${seat.changedAt}`} seat={seat} picking={picking} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

function SeatSquare({ seat, picking }: { seat: SeatCell; picking: SeatPicking }) {
  const selected = picking.selected.has(seat.id);
  const mine = picking.mine.has(seat.id);
  const label = `${seat.section} ${seat.row}${seat.number} · ${mine ? 'yours' : seat.status}`;
  const look = mine
    ? 'bg-ink seat-mine'
    : selected
      ? seat.status === 'available'
        ? 'bg-ink'
        : // Chosen, then taken by someone else: still clickable, so it can be removed.
          `${SEAT_LOOK[seat.status]} outline-2 -outline-offset-2 outline-error`
      : SEAT_LOOK[seat.status];
  // A new key (in the parent) replays the pop each time the status changes.
  const base = `size-3.5 flex-none ${look} ${seat.changedAt > 0 ? 'seat-pop' : ''}`;
  if (!picking.active) return <span title={label} className={base} />;
  const clickable = seat.status === 'available' || selected;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      disabled={!clickable}
      onClick={() => {
        picking.onToggle(seat.id);
      }}
      className={`${base} border-0 p-0 ${clickable ? 'cursor-pointer hover:outline-2 hover:outline-offset-1 hover:outline-ink' : 'cursor-not-allowed'}`}
    />
  );
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
