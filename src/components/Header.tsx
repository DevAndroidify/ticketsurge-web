import { ArrowUpRight } from 'lucide-react';
import { motion } from 'motion/react';
import type { Mode } from '../lib/types';

const BACKEND_REPO = 'https://github.com/DevAndroidify/ticketsurge';

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function Header({ mode, aside }: { mode: Mode; aside?: React.ReactNode }) {
  const other = mode === 'live' ? 'sim' : 'live';
  return (
    <header>
      <nav className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <a href="./" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="font-display text-xl font-bold tracking-tight text-ink">
            TicketSurge
          </span>
        </a>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 font-semibold ${
              mode === 'live' ? 'bg-ok/12 text-ok-ink' : 'bg-warn/15 text-warn-ink'
            }`}
          >
            <span
              className={`live-blink size-2 rounded-full ${mode === 'live' ? 'bg-ok' : 'bg-warn'}`}
            />
            {mode === 'live' ? 'Live · your local backend' : 'Simulated in your browser'}
          </span>
          <a
            href={`?mode=${other}`}
            className="font-medium text-muted underline decoration-line underline-offset-4 transition hover:text-ink hover:decoration-ink"
          >
            Switch to {other === 'live' ? 'live' : 'simulated'}
          </a>
          {mode === 'live' && (
            <>
              <NavLink href={__GRAFANA_URL__}>Grafana</NavLink>
              <NavLink href={__KAFKA_UI_URL__}>Kafka UI</NavLink>
            </>
          )}
          <NavLink href={BACKEND_REPO}>Source</NavLink>
        </div>
      </nav>

      <div className="mt-10 mb-2 grid items-center gap-10 sm:mt-14 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <h1 className="font-display text-[clamp(2.4rem,5.2vw,4.4rem)] leading-[0.98] font-bold tracking-[-0.035em] text-ink">
            <Line delay={0.05}>Thousands of buyers.</Line>
            <Line delay={0.15}>One seat each.</Line>
            <Line delay={0.25}>
              <span className="relative inline-block text-you">
                Never sold twice.
                <Scribble />
              </span>
            </Line>
          </h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.45, ease: EASE }}
            className="mt-6 max-w-2xl text-lg leading-relaxed text-muted"
          >
            A live flash sale against a real backend. Redis takes the rush, PostgreSQL decides who
            gets each seat, and Kafka carries every booking through payment and ticketing. Send in a
            crowd, buy a ticket yourself, and watch it all happen.
          </motion.p>
        </div>
        {aside}
      </div>
    </header>
  );
}

/** Each headline line slides up from behind a mask. */
function Line({ delay, children }: { delay: number; children: React.ReactNode }) {
  return (
    <span className="block overflow-hidden pb-[0.08em]">
      <motion.span
        className="block"
        initial={{ y: '105%' }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, delay, ease: EASE }}
      >
        {children}
      </motion.span>
    </span>
  );
}

/** A hand-drawn underline that draws itself after the headline lands. */
function Scribble() {
  return (
    <svg
      viewBox="0 0 300 18"
      preserveAspectRatio="none"
      className="absolute -bottom-[0.12em] left-0 h-[0.22em] w-full"
      aria-hidden
    >
      <motion.path
        d="M3 12 C 60 4, 120 3, 175 8 S 270 14, 297 6"
        fill="none"
        stroke="var(--color-kafka)"
        strokeWidth="5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, delay: 0.85, ease: 'easeInOut' }}
      />
    </svg>
  );
}

export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden>
      <rect width="36" height="36" rx="10" fill="var(--color-ink)" />
      {/* A ticket with notches on both sides and a perforated stub. */}
      <path
        d="M8 11h20v4.5a2.5 2.5 0 0 0 0 5V25H8v-4.5a2.5 2.5 0 0 0 0-5z"
        fill="var(--color-you)"
      />
      <path d="M21 12.5v11" stroke="var(--color-ink)" strokeWidth="1.6" strokeDasharray="1.6 1.8" />
    </svg>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-0.5 font-medium text-muted transition hover:text-ink"
    >
      {children}
      <ArrowUpRight className="size-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </a>
  );
}
