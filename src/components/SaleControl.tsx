import { Play, Rocket, Square, Users, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { SaleOptions } from '../lib/backend';
import { DEFAULT_SWARM, type BotPhase, type SwarmOptions } from '../lib/bots/swarm';
import { formatInt, formatRate } from '../lib/format';
import type { Mode } from '../lib/types';
import type { DashboardState } from '../state/dashboard';
import { Panel, Pill } from './ui';

const LAYOUTS: { id: string; label: string; options: SaleOptions }[] = [
  { id: 'small', label: '160 seats', options: { sections: 2, rows: 5, seatsPerRow: 16 } },
  { id: 'medium', label: '384 seats', options: { sections: 4, rows: 6, seatsPerRow: 16 } },
  { id: 'large', label: '600 seats', options: { sections: 5, rows: 6, seatsPerRow: 20 } },
];

const FUNNEL: { phase: BotPhase; label: string; color: string }[] = [
  { phase: 'registering', label: 'Signing up', color: 'bg-faint' },
  { phase: 'queued', label: 'In the waiting room', color: 'bg-redis' },
  { phase: 'holding', label: 'Picking seats', color: 'bg-warn' },
  { phase: 'booking', label: 'Booking', color: 'bg-pg' },
  { phase: 'paying', label: 'Awaiting payment', color: 'bg-kafka' },
  { phase: 'confirmed', label: 'Confirmed', color: 'bg-ok' },
  { phase: 'cancelled', label: 'Payment failed', color: 'bg-bad' },
  { phase: 'expired', label: 'Payment expired', color: 'bg-bad/60' },
  { phase: 'lost', label: 'Missed out', color: 'bg-faint' },
  { phase: 'abandoned', label: 'Walked away', color: 'bg-faint/50' },
  { phase: 'failed', label: 'Errors', color: 'bg-bad' },
];

const SURGES = [50, 200, 500];

export function SaleControl({
  mode,
  sale,
  clientRps,
  canLaunch,
  reusesEvent,
  onLaunch,
  onStop,
  onSurge,
  onArrivalRate,
}: {
  mode: Mode;
  sale: DashboardState['sale'];
  clientRps: number;
  canLaunch: boolean;
  /** The crowd will join the event already open, so its layout cannot be chosen. */
  reusesEvent: boolean;
  onLaunch: (options: SaleOptions, swarm: SwarmOptions) => void;
  onStop: () => void;
  onSurge: (count: number) => void;
  onArrivalRate: (perSecond: number) => void;
}) {
  const [bots, setBots] = useState(300);
  const [layout, setLayout] = useState('medium');
  const [abandon, setAbandon] = useState(10);

  const busy = sale.phase === 'preparing' || sale.phase === 'running';
  const swarm = sale.swarm;
  const total = swarm ? Object.values(swarm.phases).reduce((a, b) => a + b, 0) : 0;
  const crowd = swarm?.bots.length ?? 0;
  const crowdCap = DEFAULT_SWARM.maxBots ?? 0;

  const launch = () => {
    const chosen = LAYOUTS.find((l) => l.id === layout) ?? LAYOUTS[1];
    if (!chosen) return;
    onLaunch(chosen.options, { ...DEFAULT_SWARM, bots, abandonRate: abandon / 100 });
  };

  return (
    <Panel
      title="Flash sale"
      delay={0.08}
      subtitle={`Virtual buyers using the real API flow, ${mode === 'live' ? 'from this browser' : 'in the simulation'}`}
      right={
        busy ? (
          <Pill tone="info">
            <Zap className="size-3.5" /> {formatRate(clientRps)} req/s
          </Pill>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <Slider
          label={
            <>
              <Users className="size-4" /> Buyers
            </>
          }
          value={bots}
          shown={String(bots)}
          min={20}
          max={600}
          step={10}
          disabled={busy}
          onChange={setBots}
        />

        {mode === 'live' ? (
          <p className="rounded-xl bg-panel-2 px-3.5 py-2.5 text-xs leading-relaxed text-muted">
            <span className="font-semibold text-ink">Venue:</span> the newest event on sale in your
            backend. Sold out? Run{' '}
            <code className="font-mono text-ink">npm run demo:new-event</code> there.
          </p>
        ) : (
          <div>
            <div className="mb-2 text-[13px] font-medium text-muted">Venue</div>
            <div className="grid grid-cols-3 gap-2">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  disabled={busy || reusesEvent}
                  onClick={() => {
                    setLayout(l.id);
                  }}
                  className={`rounded-xl border px-2 py-2 text-[13px] font-semibold transition disabled:opacity-45 ${
                    layout === l.id
                      ? 'border-you bg-you/8 text-you-ink'
                      : 'border-line text-muted hover:border-faint hover:text-ink'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <Slider
          label="Buyers who abandon their hold"
          value={abandon}
          shown={`${abandon}%`}
          min={0}
          max={40}
          disabled={busy}
          onChange={setAbandon}
        />

        <AnimatePresence initial={false}>
          {sale.phase === 'running' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div className="rounded-2xl border border-you/25 bg-you/6 p-3.5">
                <div className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-you-ink">
                  <Rocket className="size-4" /> Increase the traffic
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {SURGES.map((count) => (
                    <motion.button
                      key={count}
                      type="button"
                      whileHover={crowd < crowdCap ? { y: -2 } : undefined}
                      whileTap={{ scale: 0.9 }}
                      disabled={crowd >= crowdCap}
                      onClick={() => {
                        onSurge(count);
                      }}
                      className="rounded-xl border border-you/30 bg-panel py-2.5 font-display text-base font-bold text-you-ink shadow-card transition-colors hover:bg-you hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      +{count}
                    </motion.button>
                  ))}
                </div>
                <div className="mt-3.5">
                  <Slider
                    label="Steady arrivals"
                    value={sale.arrivalRate}
                    shown={`${sale.arrivalRate}/s`}
                    min={0}
                    max={40}
                    onChange={onArrivalRate}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted tabular">
                  {formatInt(crowd)} of {formatInt(crowdCap)} buyers
                  {crowd >= crowdCap ? ' · crowd is full' : ''}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-bad/30 bg-bad/8 py-3 text-[15px] font-semibold text-bad-ink transition hover:bg-bad/15"
          >
            <Square className="size-4 fill-current" />
            {sale.phase === 'preparing' ? 'Preparing…' : 'Stop the sale'}
          </button>
        ) : (
          <motion.button
            type="button"
            whileHover={canLaunch ? { y: -2 } : undefined}
            whileTap={{ scale: 0.97 }}
            disabled={!canLaunch}
            onClick={launch}
            className="sheen flex w-full items-center justify-center gap-2 rounded-2xl bg-ink py-3.5 font-display text-[17px] font-semibold text-white shadow-lift disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <Play className="size-4 fill-current" />
            {reusesEvent
              ? 'Send in the crowd'
              : sale.phase === 'finished'
                ? 'Run another flash sale'
                : 'Launch flash sale'}
          </motion.button>
        )}
        {!canLaunch && !busy && (
          <p className="text-center text-xs text-muted">Waiting for the API to be up…</p>
        )}
        {sale.error && (
          <p className="rounded-xl bg-bad/10 px-3 py-2 text-[13px] text-bad-ink">{sale.error}</p>
        )}
      </div>

      {swarm && (
        <div className="mt-6 space-y-2 border-t border-line pt-5">
          {FUNNEL.map(({ phase, label, color }) => {
            const count = swarm.phases[phase];
            if (count === 0 && (phase === 'failed' || phase === 'expired')) return null;
            return (
              <div key={phase} className="flex items-center gap-2.5 text-[13px]">
                <span className="w-36 shrink-0 truncate text-muted">{label}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                  <motion.div
                    className={`h-full rounded-full ${color}`}
                    animate={{ width: `${total ? (count / total) * 100 : 0}%` }}
                    transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                  />
                </div>
                <span className="w-10 text-right font-semibold text-ink tabular">
                  {formatInt(count)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function Slider({
  label,
  value,
  shown,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: React.ReactNode;
  value: number;
  shown: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between text-[13px]">
        <span className="flex items-center gap-1.5 font-medium text-muted">{label}</span>
        <span className="font-display text-base font-bold text-ink tabular">{shown}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
        className="w-full"
      />
    </label>
  );
}
