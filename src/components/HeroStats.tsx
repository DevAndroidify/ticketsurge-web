import { Activity, Armchair, Layers, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatInt, formatRate, sum } from '../lib/format';
import type { DashboardState } from '../state/dashboard';
import { Ticker } from './ui';

export function HeroStats({ state }: { state: DashboardState }) {
  const m = state.metrics;
  const rps = Math.max(m?.http.total ?? 0, state.clientRps);
  const sold = state.sale.seats.filter((s) => s.status === 'sold').length;
  const total = state.sale.seats.length;
  const lag = m ? sum(Object.values(m.lag)) : 0;
  const doubleSold = state.sale.swarm?.doubleSold ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat icon={<Activity className="size-4" />} label="Requests / second" accent="text-http">
        <Ticker value={rps} format={formatRate} />
      </Stat>
      <Stat icon={<Armchair className="size-4" />} label="Seats sold" accent="text-seat-sold">
        <Ticker value={sold} format={formatInt} />
        <span className="text-base font-normal text-faint"> / {formatInt(total)}</span>
      </Stat>
      <Stat icon={<Layers className="size-4" />} label="Kafka consumer lag" accent="text-kafka">
        <Ticker value={lag} format={formatInt} />
      </Stat>
      <Stat
        icon={<ShieldCheck className="size-4" />}
        label="Seats sold twice"
        accent={doubleSold === 0 ? 'text-ok' : 'text-bad'}
      >
        <span className="tabular">{doubleSold}</span>
      </Stat>
    </div>
  );
}

function Stat({
  icon,
  label,
  accent,
  children,
}: {
  icon: ReactNode;
  label: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-panel/80 px-4 py-3.5">
      <div className={`flex items-center gap-1.5 text-[11px] font-medium ${accent}`}>
        {icon}
        <span className="text-muted">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold text-ink sm:text-3xl">{children}</div>
    </div>
  );
}
