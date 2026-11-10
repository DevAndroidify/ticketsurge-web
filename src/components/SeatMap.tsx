import { memo } from 'react';
import type { SocketState } from '../lib/backend';
import { formatInt } from '../lib/format';
import type { SaleEvent, SeatStatus } from '../lib/types';
import type { SeatCell } from '../state/dashboard';
import { Panel, Pill, Ticker } from './ui';

const SEAT_CLASS: Record<SeatStatus, string> = {
  available: 'bg-seat-free text-seat-free',
  held: 'bg-seat-held text-seat-held',
  sold: 'bg-seat-sold text-seat-sold',
};

/** The visitor's part in the map. Everything is empty when they are not buying. */
export interface SeatPicking {
  /** True while seats can be clicked. */
  active: boolean;
  selected: ReadonlySet<string>;
  mine: ReadonlySet<string>;
  onToggle: (seatId: string) => void;
}

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
  const counts = { available: 0, held: 0, sold: 0 };
  for (const seat of seats) counts[seat.status]++;
  const sections = groupBy(seats, (s) => s.section);

  return (
    <Panel
      title="Seat map"
      subtitle={
        event
          ? `${event.name} · ${formatInt(event.totalSeats)} seats · updates over WebSocket`
          : 'Join the sale or launch a crowd to fill it'
      }
      right={
        <div className="flex flex-wrap gap-1.5">
          {picking.active && <Pill tone="info">Your turn: click seats</Pill>}
          {degraded && <Pill tone="warn">Redis down · holds hidden</Pill>}
          <Pill tone={socket === 'open' ? 'good' : socket === 'connecting' ? 'warn' : 'neutral'}>
            ws {socket}
          </Pill>
        </div>
      }
    >
      <div className="mb-6 grid grid-cols-3 gap-2.5">
        <Count label="Available" value={counts.available} swatch="bg-seat-free" />
        <Count label="Held" value={counts.held} swatch="bg-seat-held" />
        <Count label="Sold" value={counts.sold} swatch="bg-seat-sold" />
      </div>

      {seats.length === 0 ? (
        <div className="grid h-52 place-items-center rounded-2xl border-2 border-dashed border-line text-center text-sm text-muted">
          <div>
            <div className="font-display text-lg font-semibold text-ink">The house is empty</div>
            Launch a flash sale or join one to fill it.
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="mx-auto mb-6 h-9 max-w-md rounded-b-[80px] bg-ink text-center font-display text-xs leading-9 font-semibold tracking-[0.4em] text-white">
            STAGE
          </div>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-5">
            {[...sections].map(([name, list]) => (
              <Section key={name} name={name} seats={list} picking={picking} />
            ))}
          </div>
        </div>
      )}
    </Panel>
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
  const sold = seats.filter((s) => s.status === 'sold').length;
  // Bigger seats while choosing, so they are easy to hit.
  const size = picking.active ? 'size-[16px] sm:size-[19px]' : 'size-[10px] sm:size-[11px]';
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold text-ink">{name}</span>
        <span className="text-muted tabular">
          {sold}/{seats.length}
        </span>
      </div>
      <div className="flex flex-col gap-[3px]">
        {[...rows].map(([row, list]) => (
          <div key={row} className="flex items-center gap-[3px]">
            <span className="w-3 font-mono text-[9px] text-faint">{row}</span>
            {list.map((seat) => {
              const selected = picking.selected.has(seat.id);
              const mine = picking.mine.has(seat.id);
              const label = `${seat.section} ${seat.row}${seat.number} · ${mine ? 'yours' : seat.status}`;
              const look = `rounded-t-[4px] rounded-b-[2px] transition-[width,height,background-color,transform] duration-300 ${size} ${seatLook(seat.status, selected, mine)} ${seat.changedAt > 0 ? 'seat-pop' : ''}`;
              // A new key replays the pop animation each time the status changes.
              const key = `${seat.id}:${seat.changedAt}`;
              if (!picking.active) return <span key={key} title={label} className={look} />;
              // A chosen seat that was taken stays clickable, so it can be removed.
              const clickable = seat.status === 'available' || selected;
              return (
                <button
                  key={key}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={selected}
                  disabled={!clickable}
                  onClick={() => {
                    picking.onToggle(seat.id);
                  }}
                  className={`${look} ${clickable ? 'cursor-pointer hover:scale-125 hover:bg-you/50' : 'cursor-not-allowed'}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});

function seatLook(status: SeatStatus, selected: boolean, mine: boolean): string {
  if (mine) return 'bg-you text-you seat-mine';
  if (selected) {
    return status === 'available'
      ? 'bg-you text-you ring-2 ring-you/50'
      : 'bg-bad text-bad ring-2 ring-bad/60';
  }
  return SEAT_CLASS[status];
}

function Count({ label, value, swatch }: { label: string; value: number; swatch: string }) {
  return (
    <div className="rounded-2xl bg-panel-2 px-4 py-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
        <span className={`size-2.5 rounded-[3px] ${swatch}`} />
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">
        <Ticker value={value} format={formatInt} />
      </div>
    </div>
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
