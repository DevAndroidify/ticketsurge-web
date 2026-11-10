import { ArrowDown, Play, Ticket } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { Mode } from '../lib/types';
import type { SalePhase } from '../state/dashboard';

const STEPS = [
  {
    title: 'Send in a crowd',
    text: 'Hundreds of virtual buyers rush the sale through the real API.',
  },
  { title: 'Buy a seat yourself', text: 'Queue with them, race them for seats, and pay.' },
  {
    title: 'Break something',
    text: 'Stop Redis or a service and watch the system recover without losing a booking.',
  },
];

/** The first thing a visitor sees next to the headline: what to do, and one click to start. */
export function TryIt({
  mode,
  phase,
  canStart,
  onLaunch,
  onBuy,
}: {
  mode: Mode;
  phase: SalePhase;
  canStart: boolean;
  onLaunch: () => void;
  onBuy: () => void;
}) {
  const busy = phase === 'preparing' || phase === 'running';
  return (
    <motion.aside
      initial={{ opacity: 0, y: 24, rotate: 1.5 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.8, delay: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
      className="relative overflow-hidden rounded-[26px] bg-ink p-6 text-white shadow-lift"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold tracking-[0.18em] text-white/60 uppercase">
          Try it in 30 seconds
        </span>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80">
          {mode === 'live' ? 'Your backend' : 'No setup needed'}
        </span>
      </div>

      <MiniVenue />

      <ol className="mt-5 space-y-3.5">
        {STEPS.map((step, i) => (
          <motion.li
            key={step.title}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.7 + i * 0.12, duration: 0.4 }}
            className="flex gap-3"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-you font-display text-xs font-bold">
              {i + 1}
            </span>
            <div>
              <div className="font-display text-[15px] font-semibold">{step.title}</div>
              <div className="text-[13px] leading-snug text-white/60">{step.text}</div>
            </div>
          </motion.li>
        ))}
      </ol>

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        <motion.button
          type="button"
          whileHover={canStart ? { y: -2 } : undefined}
          whileTap={{ scale: 0.96 }}
          disabled={!canStart && !busy}
          onClick={onLaunch}
          className="sheen flex items-center justify-center gap-2 rounded-2xl bg-white py-3 font-display text-[15px] font-semibold text-ink disabled:opacity-40"
        >
          {busy ? <ArrowDown className="size-4" /> : <Play className="size-4 fill-current" />}
          {busy ? 'Watch the sale' : 'Start a flash sale'}
        </motion.button>
        <motion.button
          type="button"
          whileHover={canStart ? { y: -2 } : undefined}
          whileTap={{ scale: 0.96 }}
          disabled={!canStart}
          onClick={onBuy}
          className="sheen flex items-center justify-center gap-2 rounded-2xl bg-you py-3 font-display text-[15px] font-semibold text-white disabled:opacity-40"
        >
          <Ticket className="size-4" />
          Buy a ticket
        </motion.button>
      </div>
      {!canStart && (
        <p className="mt-3 text-center text-xs text-white/50">Waiting for the API to be up…</p>
      )}
    </motion.aside>
  );
}

const ROWS = 3;
const PER_ROW = 16;
type MiniSeat = 0 | 1 | 2;

/** A tiny venue that sells itself out on a loop: free, then held, then sold. Decoration only. */
function MiniVenue() {
  const [seats, setSeats] = useState<MiniSeat[]>(() => new Array<MiniSeat>(ROWS * PER_ROW).fill(0));

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => {
      setSeats((current) => {
        if (current.every((s) => s === 2)) return current.map(() => 0);
        const next = [...current];
        // Held seats sell, and a few new ones are grabbed, so the house fills in waves.
        next.forEach((s, i) => {
          if (s === 1 && Math.random() < 0.45) next[i] = 2;
        });
        for (let k = 0; k < 3; k++) {
          const free = next.flatMap((s, i) => (s === 0 ? [i] : []));
          const pick = free[Math.floor(Math.random() * free.length)];
          if (pick !== undefined) next[pick] = 1;
        }
        return next;
      });
    }, 260);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="mt-5 rounded-2xl bg-white/[0.06] p-4" aria-hidden>
      <div className="mx-auto mb-3 h-1.5 w-2/5 rounded-full bg-white/25" />
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${PER_ROW}, 1fr)` }}>
        {seats.map((seat, i) => (
          <span
            key={`${i}-${seat}`}
            className={`aspect-square rounded-t-[4px] rounded-b-[2px] ${
              seat === 0
                ? 'bg-white/15'
                : seat === 1
                  ? 'seat-pop bg-seat-held'
                  : 'seat-pop bg-seat-sold'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
