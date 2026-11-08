import { motion, useSpring, useTransform } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import type { ComponentState } from '../lib/types';

export function Panel({
  title,
  subtitle,
  right,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-line bg-panel/80 p-4 shadow-[0_1px_0_rgb(255_255_255/0.03)_inset] backdrop-blur sm:p-5 ${className}`}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

/** A number that glides to its new value instead of jumping. */
export function Ticker({
  value,
  format,
  className = '',
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const spring = useSpring(value, { stiffness: 90, damping: 20 });
  const text = useTransform(spring, (n) => format(n));
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  return <motion.span className={`tabular ${className}`}>{text}</motion.span>;
}

const STATE_COLOR: Record<ComponentState, string> = {
  up: 'bg-ok',
  down: 'bg-bad',
  starting: 'bg-warn',
  unknown: 'bg-faint',
};

export function StatusDot({ state }: { state: ComponentState }) {
  const color = STATE_COLOR[state];
  return (
    <span className="relative inline-flex size-2.5 shrink-0">
      {(state === 'up' || state === 'starting') && (
        <span className={`ping-soft absolute inline-flex size-full rounded-full ${color}`} />
      )}
      <span className={`relative inline-flex size-2.5 rounded-full ${color}`} />
    </span>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'border-line bg-panel-2 text-muted',
  good: 'border-ok/30 bg-ok/10 text-ok',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  bad: 'border-bad/30 bg-bad/10 text-bad',
  info: 'border-http/30 bg-http/10 text-http',
};
