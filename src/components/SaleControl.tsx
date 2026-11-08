import { Play, Square, Users, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import type { SaleOptions } from '../lib/backend';
import { DEFAULT_SWARM, type BotPhase, type SwarmOptions } from '../lib/bots/swarm';
import { formatInt, formatRate } from '../lib/format';
import type { Mode } from '../lib/types';
import type { DashboardState } from '../state/dashboard';
import { Panel, Pill } from './ui';

const LAYOUTS: { id: string; label: string; options: Omit<SaleOptions, 'admin'> }[] = [
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
  { phase: 'lost', label: 'Missed out', color: 'bg-muted' },
  { phase: 'abandoned', label: 'Walked away', color: 'bg-muted/50' },
  { phase: 'failed', label: 'Errors', color: 'bg-bad' },
];

export function SaleControl({
  mode,
  sale,
  clientRps,
  canLaunch,
  onLaunch,
  onStop,
}: {
  mode: Mode;
  sale: DashboardState['sale'];
  clientRps: number;
  canLaunch: boolean;
  onLaunch: (options: SaleOptions, swarm: SwarmOptions) => void;
  onStop: () => void;
}) {
  const [bots, setBots] = useState(300);
  const [layout, setLayout] = useState('medium');
  const [abandon, setAbandon] = useState(10);
  const [adminEmail, setAdminEmail] = useState('admin@ticketsurge.local');
  const [adminPassword, setAdminPassword] = useState('');

  const busy = sale.phase === 'preparing' || sale.phase === 'running';
  const swarm = sale.swarm;
  const total = swarm ? Object.values(swarm.phases).reduce((a, b) => a + b, 0) : 0;

  const launch = () => {
    const chosen = LAYOUTS.find((l) => l.id === layout) ?? LAYOUTS[1];
    if (!chosen) return;
    onLaunch(
      {
        ...chosen.options,
        ...(mode === 'live' && adminPassword
          ? { admin: { email: adminEmail.trim(), password: adminPassword } }
          : {}),
      },
      { ...DEFAULT_SWARM, bots, abandonRate: abandon / 100 },
    );
  };

  return (
    <Panel
      title="Flash sale"
      subtitle={`Virtual buyers using the real API flow, ${mode === 'live' ? 'from this browser' : 'in the simulation'}`}
      right={
        busy ? (
          <Pill tone="info">
            <Zap className="size-3" /> {formatRate(clientRps)} req/s
          </Pill>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <label className="block">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="flex items-center gap-1.5 text-muted">
              <Users className="size-3.5" /> Buyers
            </span>
            <span className="font-mono text-ink tabular">{bots}</span>
          </div>
          <input
            type="range"
            min={20}
            max={600}
            step={10}
            value={bots}
            disabled={busy}
            onChange={(e) => {
              setBots(Number(e.target.value));
            }}
            className="w-full"
          />
        </label>

        <div>
          <div className="mb-1.5 text-xs text-muted">Venue</div>
          <div className="grid grid-cols-3 gap-1.5">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  setLayout(l.id);
                }}
                className={`rounded-lg border px-2 py-1.5 text-xs transition disabled:opacity-50 ${
                  layout === l.id
                    ? 'border-http/60 bg-http/10 text-ink'
                    : 'border-line text-muted hover:border-faint'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-muted">Buyers who abandon their hold</span>
            <span className="font-mono text-ink tabular">{abandon}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={40}
            value={abandon}
            disabled={busy}
            onChange={(e) => {
              setAbandon(Number(e.target.value));
            }}
            className="w-full"
          />
        </label>

        {mode === 'live' && (
          <details className="rounded-lg border border-line bg-panel-2/40 px-3 py-2 text-xs">
            <summary className="cursor-pointer text-muted">Fresh event each run (admin)</summary>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              An account in the backend&apos;s <code>ADMIN_EMAILS</code> creates a new event through{' '}
              <code>POST /admin/events</code>. It is signed up on first use. Leave the password
              empty to reuse an event that still has free seats (e.g. the seeded demo event).
            </p>
            <div className="mt-2 grid gap-1.5">
              <input
                value={adminEmail}
                onChange={(e) => {
                  setAdminEmail(e.target.value);
                }}
                placeholder="admin email"
                autoComplete="username"
                className="rounded-md border border-line bg-bg px-2 py-1.5 text-ink outline-none focus:border-http/60"
              />
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => {
                  setAdminPassword(e.target.value);
                }}
                placeholder="password (8+ characters)"
                autoComplete="current-password"
                className="rounded-md border border-line bg-bg px-2 py-1.5 text-ink outline-none focus:border-http/60"
              />
            </div>
          </details>
        )}

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-bad/40 bg-bad/10 py-2.5 text-sm font-semibold text-bad transition hover:bg-bad/20"
          >
            <Square className="size-4" />
            {sale.phase === 'preparing' ? 'Preparing…' : 'Stop the sale'}
          </button>
        ) : (
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            disabled={!canLaunch}
            onClick={launch}
            className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-http py-2.5 text-sm font-semibold text-white shadow-[0_0_30px_rgb(107_147_255/0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <Play className="size-4" />
            {sale.phase === 'finished' ? 'Run another flash sale' : 'Launch flash sale'}
          </motion.button>
        )}
        {!canLaunch && !busy && (
          <p className="text-center text-[11px] text-faint">Waiting for the API to be up…</p>
        )}
        {sale.error && (
          <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
            {sale.error}
          </p>
        )}
      </div>

      {swarm && (
        <div className="mt-5 space-y-1.5">
          {FUNNEL.map(({ phase, label, color }) => {
            const count = swarm.phases[phase];
            if (count === 0 && (phase === 'failed' || phase === 'expired')) return null;
            return (
              <div key={phase} className="flex items-center gap-2 text-[11px]">
                <span className="w-32 shrink-0 truncate text-muted">{label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
                  <motion.div
                    className={`h-full rounded-full ${color}`}
                    animate={{ width: `${total ? (count / total) * 100 : 0}%` }}
                    transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                  />
                </div>
                <span className="w-9 text-right font-mono text-ink tabular">
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
