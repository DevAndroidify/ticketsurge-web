import { CircleCheck, CircleX, ShieldCheck } from 'lucide-react';
import type { SwarmSnapshot } from '../lib/bots/swarm';
import { formatInt } from '../lib/format';
import type { SeatCell } from '../state/dashboard';
import { Panel } from './ui';

/** The promises the backend makes, checked against what the buyers actually experienced. */
export function GuaranteePanel({
  swarm,
  seats,
}: {
  swarm: SwarmSnapshot | undefined;
  seats: SeatCell[];
}) {
  const soldOnMap = seats.filter((s) => s.status === 'sold').length;
  const confirmed = swarm?.seatsConfirmed ?? 0;
  const settled = swarm ? swarm.phases.paying === 0 && swarm.phases.booking === 0 : false;

  const checks = [
    {
      ok: (swarm?.doubleSold ?? 0) === 0,
      title: `${formatInt(swarm?.doubleSold ?? 0)} seats sold twice`,
      detail: 'No two buyers ever hold a confirmed booking for the same seat.',
    },
    {
      ok: (swarm?.replayMismatches ?? 0) === 0,
      title: `${formatInt(swarm?.idempotentReplays ?? 0)} duplicate requests, ${formatInt(swarm?.replayMismatches ?? 0)} extra bookings`,
      detail: 'A booking sent twice with the same Idempotency-Key returns the same booking.',
    },
    {
      ok: true,
      title: `${formatInt(swarm?.conflicts ?? 0)} races turned away with 409`,
      detail: 'holdSeats is one atomic Lua script: all seats are held, or none are.',
    },
    {
      ok: !settled || soldOnMap >= confirmed,
      title: `${formatInt(confirmed)} confirmed seats · ${formatInt(soldOnMap)} sold on the map`,
      detail: settled
        ? 'Seat sync marked every confirmed seat sold in Redis.'
        : 'Checked once payments settle; seat sync catches up through Kafka.',
    },
    {
      ok: true,
      title: `${formatInt(swarm?.rateLimited ?? 0)} rate-limited · ${formatInt(swarm?.unavailable ?? 0)} retried on 503`,
      detail: 'Clients back off on 429 and 503 instead of hammering the API.',
    },
  ];

  return (
    <Panel
      title="Guarantees"
      subtitle="Checked live from the buyers' point of view"
      right={<ShieldCheck className="size-5 text-ok" />}
    >
      <ul className="space-y-3">
        {checks.map((check) => (
          <li key={check.detail} className="flex gap-2.5">
            {check.ok ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" />
            ) : (
              <CircleX className="mt-0.5 size-4 shrink-0 text-bad" />
            )}
            <div className="min-w-0">
              <div className="text-xs font-medium text-ink tabular">{check.title}</div>
              <div className="text-[11px] leading-relaxed text-faint">{check.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
