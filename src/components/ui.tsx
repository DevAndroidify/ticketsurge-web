import { motion, useSpring, useTransform } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import type { ComponentState } from '../lib/types';

/**
 * A white card that rises into place when the page loads. On mount rather than on scroll, so a
 * card can never stay invisible (full-page screenshots, printing, very tall screens).
 */
export function Panel({
  title,
  subtitle,
  right,
  children,
  className = '',
  delay = 0,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Seconds to wait before rising in, so neighbouring cards arrive one after another. */
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.6 + delay, ease: [0.2, 0.8, 0.2, 1] }}
      className={`rounded-[22px] border border-line bg-panel p-5 shadow-card sm:p-6 ${className}`}
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl leading-tight font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-[13px] leading-snug text-muted">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </motion.section>
  );
}

/** A numbered chapter heading, so a first-time visitor can follow the page top to bottom. */
export function SectionHeading({
  id,
  number,
  title,
  text,
}: {
  id: string;
  number: string;
  title: string;
  text: string;
}) {
  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
      className="flex scroll-mt-6 flex-wrap items-end gap-x-5 gap-y-1 pt-8"
    >
      <span className="font-mono text-sm font-semibold text-you-ink">{number}</span>
      <h2 className="font-display text-3xl leading-none font-bold tracking-tight text-ink">
        {title}
      </h2>
      <p className="text-[15px] text-muted">{text}</p>
    </motion.div>
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-panel-2 text-muted',
  good: 'bg-ok/12 text-ok-ink',
  warn: 'bg-warn/15 text-warn-ink',
  bad: 'bg-bad/12 text-bad-ink',
  info: 'bg-you/10 text-you-ink',
};
