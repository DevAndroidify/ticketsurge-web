import { motion, useSpring, useTransform } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import type { ComponentState } from '../lib/types';

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Reveal once, when a fifth of the element is on screen. */
const VIEWPORT = { once: true, amount: 0.15 } as const;

/**
 * A white box with a 1px line that rises into place as it scrolls into view, while a hairline
 * draws across its top. Reduced motion turns both off (MotionConfig in App).
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
  /** Seconds to wait before rising in, so neighbouring boxes arrive one after another. */
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.7, delay, ease: EASE }}
      className={`relative border border-line bg-panel p-5 sm:p-6 ${className}`}
    >
      <motion.span
        aria-hidden="true"
        className="absolute -top-px -left-px h-0.5 w-[calc(100%+2px)] origin-left bg-ink"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.9, delay: delay + 0.15, ease: EASE }}
      />
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl leading-tight font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-1 text-sm leading-snug text-muted">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </motion.section>
  );
}

/**
 * A numbered chapter heading for the scrolling part of the page: the number and title slide in,
 * and the rule under them draws from left to right.
 */
export function SectionHeading({
  id,
  number,
  title,
  text,
}: {
  id?: string;
  number: string;
  title: string;
  text: string;
}) {
  return (
    <div id={id} className="scroll-mt-20 pt-6">
      <motion.div
        initial={{ opacity: 0, x: -16 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.6, ease: EASE }}
        className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pb-3"
      >
        <span className="text-[30px] leading-none font-medium text-accent-text tabular">
          {number}
        </span>
        <h2 className="m-0 text-[28px] leading-none font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        <p className="m-0 text-[15px] text-muted">{text}</p>
      </motion.div>
      <motion.div
        aria-hidden="true"
        className="h-px origin-left bg-ink"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={VIEWPORT}
        transition={{ duration: 1, delay: 0.1, ease: EASE }}
      />
    </div>
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
