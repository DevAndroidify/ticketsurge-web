import { memo } from 'react';
import type { SocketState } from '../lib/backend';
import { formatInt } from '../lib/format';
import type { SaleEvent, SeatStatus } from '../lib/types';
import type { SeatCell } from '../state/dashboard';
import { Panel, Pill } from './ui';

const SEAT_CLASS: Record<SeatStatus, string> = {
  available: 'bg-seat-free text-seat-free',
  held: 'bg-seat-held text-seat-held',
  sold: 'bg-seat-sold text-seat-sold',
};

export function SeatMap({
  event,
  seats,
  socket,
  degraded,
}: {
  event?: SaleEvent;
  seats: SeatCell[];
  socket: SocketState;
  degraded: boolean;
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
          : 'Launch a flash sale to fill it'
      }
      right={
        <div className="flex flex-wrap gap-1.5">
          {degraded && <Pill tone="warn">Redis down · holds hidden</Pill>}
          <Pill tone={socket === 'open' ? 'good' : socket === 'connecting' ? 'warn' : 'neutral'}>
            ws {socket}
          </Pill>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Count label="Available" value={counts.available} swatch="bg-seat-free" />
        <Count label="Held" value={counts.held} swatch="bg-seat-held" />
        <Count label="Sold" value={counts.sold} swatch="bg-seat-sold" />
      </div>

      {seats.length === 0 ? (
        <div className="grid h-48 place-items-center rounded-xl border border-dashed border-line text-xs text-faint">
          No sale running
        </div>
      ) : (
        <>
          <div className="mx-auto mb-4 h-6 max-w-sm rounded-b-[40px] border border-t-0 border-line bg-gradient-to-b from-panel-2 to-transparent text-center text-[10px] leading-6 tracking-[0.3em] text-faint">
            STAGE
          </div>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-4">
            {[...sections].map(([name, list]) => (
              <Section key={name} name={name} seats={list} />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

const Section = memo(function Section({ name, seats }: { name: string; seats: SeatCell[] }) {
  const rows = groupBy(seats, (s) => s.row);
  const sold = seats.filter((s) => s.status === 'sold').length;
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[11px]">
        <span className="font-medium text-muted">{name}</span>
        <span className="tabular text-faint">
          {sold}/{seats.length}
        </span>
      </div>
      <div className="flex flex-col gap-[3px]">
        {[...rows].map(([row, list]) => (
          <div key={row} className="flex items-center gap-[3px]">
            <span className="w-3 font-mono text-[8px] text-faint">{row}</span>
            {list.map((seat) => {
              return (
                <span
                  // A new key replays the pop animation each time the status changes.
                  key={`${seat.id}:${seat.changedAt}`}
                  title={`${seat.section} ${seat.row}${seat.number} · ${seat.status}`}
                  className={`size-[9px] rounded-[2px] transition-colors duration-500 sm:size-[10px] ${SEAT_CLASS[seat.status]} ${seat.changedAt > 0 ? 'seat-pop' : ''}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});

function Count({ label, value, swatch }: { label: string; value: number; swatch: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2/60 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <span className={`size-2 rounded-sm ${swatch}`} />
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular">{formatInt(value)}</div>
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
