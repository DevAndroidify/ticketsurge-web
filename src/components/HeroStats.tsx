import { Check, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { formatInt, formatRate, sum } from '../lib/format';
import type { DashboardState } from '../state/dashboard';
import { Ticker } from './ui';

/** The four numbers that tell the story, in one band under the headline. */
export function HeroStats({ state }: { state: DashboardState }) {
  const m = state.metrics;
  const rps = Math.max(m?.http.total ?? 0, state.clientRps);
  const sold = state.sale.seats.filter((s) => s.status === 'sold').length;
  const total = state.sale.seats.length;
  const lag = m ? sum(Object.values(m.lag)) : 0;
  const doubleSold = state.sale.swarm?.doubleSold ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
      className="grid grid-cols-2 overflow-hidden rounded-[22px] border border-line bg-panel shadow-card lg:grid-cols-4"
    >
      <Stat label="Requests per second" bar="bg-http">
        <Ticker value={rps} format={formatRate} />
      </Stat>
      <Stat label="Seats sold" bar="bg-seat-sold">
        <Ticker value={sold} format={formatInt} />
        <span className="ml-1 text-2xl font-medium text-faint">/ {formatInt(total)}</span>
        {total > 0 && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
            <motion.div
              className="h-full rounded-full bg-seat-sold"
              animate={{ width: `${(sold / total) * 100}%` }}
              transition={{ type: 'spring', stiffness: 80, damping: 20 }}
            />
          </div>
        )}
      </Stat>
      <Stat label="Kafka consumer lag" bar="bg-kafka">
        <Ticker value={lag} format={formatInt} />
      </Stat>
      <Stat label="Seats sold twice" bar={doubleSold === 0 ? 'bg-ok' : 'bg-bad'}>
        <span className="flex items-center gap-3">
          <span className="tabular">{doubleSold}</span>
          <span
            className={`grid size-8 place-items-center rounded-full ${
              doubleSold === 0 ? 'bg-ok/12 text-ok-ink' : 'bg-bad/12 text-bad-ink'
            }`}
          >
            {doubleSold === 0 ? (
              <Check className="size-4.5" strokeWidth={3} />
            ) : (
              <X className="size-4.5" strokeWidth={3} />
            )}
          </span>
        </span>
      </Stat>
    </motion.div>
  );
}

function Stat({ label, bar, children }: { label: string; bar: string; children: ReactNode }) {
  return (
    <div className="relative border-line px-5 py-5 not-last:border-r max-lg:nth-[2]:border-r-0 max-lg:nth-[-n+2]:border-b sm:px-6">
      <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
        <span className={`h-3 w-1 rounded-full ${bar}`} />
        {label}
      </div>
      <div className="mt-2 font-display text-[2.6rem] leading-none font-bold tracking-tight text-ink sm:text-5xl">
        {children}
      </div>
    </div>
  );
}
