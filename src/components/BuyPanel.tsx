import {
  AlertTriangle,
  Armchair,
  Check,
  CreditCard,
  Loader2,
  RotateCcw,
  Ticket,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import {
  MAX_SEATS,
  type JourneyEntry,
  type JourneySnapshot,
  type JourneyStep,
  type JourneyTech,
  type JourneyTone,
} from '../lib/buyer/journey';
import { formatInt, formatMoney, formatMs } from '../lib/format';
import type { SaleEvent } from '../lib/types';
import type { SalePhase, SeatCell } from '../state/dashboard';
import { Panel, Ticker } from './ui';
import { useNow } from './useNow';

const TRACK: { label: string; steps: readonly JourneyStep[] }[] = [
  { label: 'Sign up', steps: ['signing-in'] },
  { label: 'Queue', steps: ['queued'] },
  { label: 'Seats', steps: ['picking', 'holding'] },
  { label: 'Hold', steps: ['held', 'hold-lost', 'released'] },
  { label: 'Pay', steps: ['booking', 'paying', 'cancelled', 'expired'] },
  { label: 'Ticket', steps: ['confirmed'] },
];

const FAILED: readonly JourneyStep[] = ['hold-lost', 'cancelled', 'expired', 'error'];

const TECH_DOT: Record<JourneyTech, string> = {
  http: 'bg-http',
  redis: 'bg-redis',
  pg: 'bg-pg',
  kafka: 'bg-kafka',
  ws: 'bg-ws',
};

const EASE = [0.2, 0.8, 0.2, 1] as const;

const seatLabel = (seat: SeatCell) => `${seat.section} ${seat.row}${seat.number}`;

export function BuyPanel({
  buyer,
  seats,
  event,
  phase,
  canStart,
  error,
  onStart,
  onHold,
  onPay,
  onRelease,
  onReset,
}: {
  buyer: JourneySnapshot | undefined;
  seats: SeatCell[];
  event: SaleEvent | undefined;
  phase: SalePhase;
  canStart: boolean;
  error: string | undefined;
  onStart: () => void;
  onHold: () => void;
  onPay: () => void;
  onRelease: () => void;
  onReset: () => void;
}) {
  const step = buyer?.step ?? 'idle';
  const byId = new Map(seats.map((s) => [s.id, s]));
  const pick = (ids: readonly string[] = []) =>
    ids.flatMap((id) => {
      const seat = byId.get(id);
      return seat ? [seat] : [];
    });
  const selected = pick(buyer?.selected);
  const yours = pick(buyer?.seats);
  const free = seats.some((s) => s.status === 'available');

  return (
    <Panel
      title="Buy a ticket yourself"
      subtitle="You take the same path as the crowd, through the same API"
      className="xl:sticky xl:top-5"
      delay={0.1}
    >
      <Track step={step} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={stageKey(step)}
          initial={{ opacity: 0, y: 14, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
          transition={{ duration: 0.25, ease: EASE }}
          className="mt-5"
        >
          {step === 'idle' && (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-muted">
                {event
                  ? `Join ${event.name}. If a crowd is running, you queue behind it.`
                  : 'Opens a sale with nobody else in it. Send in a crowd whenever you like, and race it for seats.'}
              </p>
              <Primary
                icon={Ticket}
                disabled={!canStart || phase === 'preparing'}
                onClick={onStart}
              >
                {phase === 'preparing' ? 'Opening the sale…' : 'Join the sale'}
              </Primary>
              {!canStart && (
                <p className="text-center text-xs text-muted">Waiting for the API to be up…</p>
              )}
              {error && <Notice tone="bad">{error}</Notice>}
            </div>
          )}

          {step === 'signing-in' && <Working>Creating your account…</Working>}

          {step === 'queued' && (
            <div className="rounded-2xl bg-redis/8 py-5 text-center">
              <div className="text-xs font-semibold tracking-[0.18em] text-redis-ink uppercase">
                Your place in line
              </div>
              <div className="my-1 font-display text-7xl leading-none font-bold tracking-tight text-redis">
                {buyer?.position === undefined ? (
                  '…'
                ) : (
                  <>
                    #<Ticker value={buyer.position} format={formatInt} />
                  </>
                )}
              </div>
              <div className="mt-2 flex items-center justify-center gap-1.5 text-[13px] text-muted">
                <Loader2 className="size-3.5 animate-spin" />
                Admitted in batches by the admission worker
              </div>
            </div>
          )}

          {(step === 'picking' || step === 'holding') && (
            <div className="space-y-3">
              {selected.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-you/40 bg-you/5 px-3 py-5 text-center text-sm font-medium text-you-ink">
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Armchair className="mx-auto mb-2 size-6" />
                  </motion.div>
                  {free
                    ? `Click up to ${MAX_SEATS} seats on the map`
                    : 'Nothing is free right now. Held seats come back when their hold ends.'}
                </div>
              ) : (
                <SeatList seats={selected} />
              )}
              {selected.some((s) => s.status !== 'available') && (
                <Notice tone="warn">
                  A seat you chose was just taken. Try anyway to see Redis refuse the whole request,
                  or click it to remove it.
                </Notice>
              )}
              <Primary
                icon={step === 'holding' ? Loader2 : Armchair}
                spin={step === 'holding'}
                disabled={selected.length === 0 || step === 'holding'}
                onClick={onHold}
              >
                {step === 'holding'
                  ? 'Asking Redis…'
                  : `Hold ${selected.length || ''} seat${selected.length === 1 ? '' : 's'}`}
              </Primary>
            </div>
          )}

          {step === 'held' && buyer?.holdExpiresAt !== undefined && (
            <div className="space-y-3">
              <HoldCountdown expiresAt={buyer.holdExpiresAt} />
              <SeatList seats={yours} />
              <Primary icon={CreditCard} onClick={onPay}>
                Pay {formatMoney(total(yours))}
              </Primary>
              <button
                type="button"
                onClick={onRelease}
                className="w-full rounded-xl py-2 text-[13px] font-medium text-muted transition hover:bg-panel-2 hover:text-ink"
              >
                Let them go
              </button>
              <p className="text-center text-xs text-muted">
                No card needed: payment-service simulates the charge, and it sometimes declines.
              </p>
            </div>
          )}

          {(step === 'booking' || step === 'paying') && (
            <Working>
              {step === 'booking'
                ? 'Writing your booking to PostgreSQL…'
                : 'Kafka has it. Waiting for the payment result…'}
            </Working>
          )}

          {step === 'confirmed' && (
            <div className="space-y-3">
              <TicketCard event={event} seats={yours} bookingId={buyer?.bookingId} />
              <Again onReset={onReset} />
            </div>
          )}

          {(step === 'cancelled' ||
            step === 'expired' ||
            step === 'hold-lost' ||
            step === 'released' ||
            step === 'error') && (
            <motion.div
              className="space-y-3"
              animate={step === 'released' ? undefined : { x: [0, -8, 7, -5, 3, 0] }}
              transition={{ duration: 0.45, delay: 0.1 }}
            >
              <Notice tone={step === 'released' ? 'info' : 'bad'}>
                {buyer?.message ?? 'The purchase ended.'}
              </Notice>
              <Again onReset={onReset} />
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>

      {buyer?.message && !isEnded(step) && (
        <div className="mt-3">
          <Notice tone="warn">{buyer.message}</Notice>
        </div>
      )}

      {buyer && buyer.log.length > 0 && <Timeline log={buyer.log} />}
    </Panel>
  );
}

function isEnded(step: JourneyStep) {
  return ['confirmed', 'cancelled', 'expired', 'hold-lost', 'released', 'error'].includes(step);
}

/** One screen can cover several steps; only a change of screen should animate. */
function stageKey(step: JourneyStep): string {
  if (step === 'picking' || step === 'holding') return 'picking';
  if (step === 'booking' || step === 'paying') return 'paying';
  return step;
}

function total(seats: readonly SeatCell[]) {
  return seats.reduce((sum, seat) => sum + seat.priceMinor, 0);
}

function Track({ step }: { step: JourneyStep }) {
  const current = TRACK.findIndex((t) => t.steps.includes(step));
  const failed = FAILED.includes(step);
  return (
    <ol className="flex items-start">
      {TRACK.map((item, index) => {
        const done = index < current || step === 'confirmed';
        const active = index === current && step !== 'confirmed';
        return (
          <li key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="relative flex w-full items-center justify-center">
              {index > 0 && (
                <span className="absolute top-1/2 right-1/2 left-[-50%] h-[3px] -translate-y-1/2 rounded-full bg-panel-2">
                  <motion.span
                    className="block h-full origin-left rounded-full bg-you"
                    initial={false}
                    animate={{ scaleX: index <= current || step === 'confirmed' ? 1 : 0 }}
                    transition={{ duration: 0.45, ease: EASE }}
                  />
                </span>
              )}
              <motion.span
                initial={false}
                animate={{ scale: active ? 1.18 : 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                className={`relative z-10 grid size-6 place-items-center rounded-full text-[11px] leading-none font-bold transition-colors ${
                  active && failed
                    ? 'bg-bad text-white'
                    : active
                      ? 'bg-you text-white shadow-[0_0_0_4px_rgb(122_60_243/0.18)]'
                      : done
                        ? 'bg-you text-white'
                        : 'bg-panel-2 text-faint'
                }`}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              </motion.span>
            </div>
            <span
              className={`truncate text-[11px] font-medium ${active || done ? 'text-ink' : 'text-faint'}`}
            >
              {item.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Its own component, so only the ring redraws every frame. */
function HoldCountdown({ expiresAt }: { expiresAt: number }) {
  const [duration] = useState(() => Math.max(1000, expiresAt - Date.now()));
  const now = useNow();
  const left = Math.max(0, expiresAt - now);
  const fraction = Math.min(1, left / duration);
  const urgent = left < Math.min(15_000, duration / 3);
  const seconds = Math.ceil(left / 1000);
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className={`flex items-center gap-3.5 rounded-2xl p-3.5 transition-colors ${urgent ? 'bg-bad/8' : 'bg-you/6'}`}
    >
      <motion.div
        className="relative size-16 shrink-0"
        animate={urgent ? { scale: [1, 1.06, 1] } : { scale: 1 }}
        transition={urgent ? { duration: 1, repeat: Infinity } : undefined}
      >
        <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke="var(--color-panel)"
            strokeWidth="6"
          />
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke={urgent ? 'var(--color-bad)' : 'var(--color-you)'}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
          />
        </svg>
        <span
          className={`absolute inset-0 grid place-items-center font-display text-sm font-bold tabular ${urgent ? 'text-bad-ink' : 'text-ink'}`}
        >
          {seconds >= 60
            ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
            : `${seconds}s`}
        </span>
      </motion.div>
      <p className="text-[13px] leading-relaxed text-muted">
        <span className="font-semibold text-ink">These seats are yours for now.</span> Nobody else
        can take them until the Redis TTL runs out.
      </p>
    </div>
  );
}

function SeatList({ seats }: { seats: readonly SeatCell[] }) {
  return (
    <div className="rounded-2xl bg-panel-2 p-3.5">
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>
          {seats.map((seat) => (
            <motion.li
              key={seat.id}
              layout
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="flex justify-between text-sm"
            >
              <span
                className={`font-medium ${
                  seat.status === 'available' || seat.status === 'held'
                    ? 'text-ink'
                    : 'text-faint line-through'
                }`}
              >
                {seatLabel(seat)}
              </span>
              <span className="text-muted tabular">{formatMoney(seat.priceMinor)}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <div className="mt-2.5 flex justify-between border-t border-line pt-2.5 font-display text-base font-bold">
        <span>Total</span>
        <span className="tabular">{formatMoney(total(seats))}</span>
      </div>
    </div>
  );
}

/** A real-looking ticket: violet body, perforated stub, and a shine that sweeps once. */
function TicketCard({
  event,
  seats,
  bookingId,
}: {
  event: SaleEvent | undefined;
  seats: readonly SeatCell[];
  bookingId: string | undefined;
}) {
  return (
    <div className="relative" style={{ perspective: 900 }}>
      <Confetti />
      <motion.div
        initial={{ rotateX: -80, opacity: 0, y: 30, scale: 0.92 }}
        animate={{ rotateX: 0, opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 140, damping: 13 }}
        className="relative flex overflow-hidden rounded-2xl bg-you text-white shadow-lift"
      >
        <div className="min-w-0 flex-1 p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.2em] text-white/80 uppercase">
            <Check className="size-3.5" strokeWidth={3} /> Confirmed
          </div>
          <div className="mt-2 font-display text-xl leading-tight font-bold">{event?.name}</div>
          <div className="text-[13px] text-white/75">{event?.venue}</div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {seats.map((seat, i) => (
              <motion.span
                key={seat.id}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.35 + i * 0.08, type: 'spring', stiffness: 400 }}
                className="rounded-md bg-white/20 px-2 py-0.5 font-mono text-xs font-semibold"
              >
                {seatLabel(seat)}
              </motion.span>
            ))}
          </div>
          <div className="mt-3 truncate font-mono text-[10px] text-white/60">
            Booking {bookingId}
          </div>
        </div>
        {/* The stub: notches top and bottom, a dashed tear line. */}
        <div className="relative grid w-16 shrink-0 place-items-center border-l-2 border-dashed border-white/40 bg-ink">
          <span className="absolute -top-2.5 -left-2.5 size-5 rounded-full bg-panel" />
          <span className="absolute -bottom-2.5 -left-2.5 size-5 rounded-full bg-panel" />
          <span className="rotate-90 font-display text-sm font-bold tracking-[0.3em] whitespace-nowrap">
            ADMIT {seats.length}
          </span>
        </div>
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/35 to-transparent"
          initial={{ x: '-120%' }}
          animate={{ x: '320%' }}
          transition={{ duration: 1.1, delay: 0.55, ease: 'easeInOut' }}
        />
      </motion.div>
    </div>
  );
}

const CONFETTI_COLORS = ['bg-you', 'bg-kafka', 'bg-http', 'bg-ok', 'bg-redis', 'bg-pg'];

const PIECES = Array.from({ length: 34 }, (_, i) => {
  const angle = -Math.PI / 2 + ((i / 34) * 2 - 1) * 1.25;
  const reach = 90 + ((i * 53) % 80);
  return {
    x: Math.cos(angle) * reach * 1.3,
    y: Math.sin(angle) * reach,
    rotate: ((i * 97) % 360) + 360,
    wide: i % 3 === 0,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? 'bg-you',
  };
});

/** Confetti that bursts up from the ticket, then falls. */
function Confetti() {
  return (
    <div className="pointer-events-none absolute top-1/3 left-1/2 z-10" aria-hidden>
      {PIECES.map((piece, i) => (
        <motion.span
          key={i}
          className={`absolute rounded-[1px] ${piece.wide ? 'h-1.5 w-2.5' : 'h-2.5 w-1.5'} ${piece.color}`}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{
            x: [0, piece.x, piece.x * 1.1],
            y: [0, piece.y, piece.y + 140],
            opacity: [1, 1, 0],
            rotate: piece.rotate,
          }}
          transition={{
            duration: 1.6,
            ease: ['easeOut', 'easeIn'],
            times: [0, 0.4, 1],
            delay: 0.1,
          }}
        />
      ))}
    </div>
  );
}

const TONE_TEXT: Record<JourneyTone, string> = {
  bad: 'text-bad-ink',
  warn: 'text-warn-ink',
  good: 'text-ok-ink',
  info: 'text-ink',
};

function Timeline({ log }: { log: readonly JourneyEntry[] }) {
  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="mb-3 font-display text-base font-semibold text-ink">What just happened</h3>
      <ul className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[4.5px] before:w-px before:bg-line">
        <AnimatePresence initial={false}>
          {log.slice(0, 6).map((entry) => (
            <motion.li
              key={entry.id}
              layout
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="relative flex gap-3"
            >
              <span
                className={`mt-1.5 size-2.5 shrink-0 rounded-full ring-3 ring-panel ${TECH_DOT[entry.tech]}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[13px] font-semibold ${TONE_TEXT[entry.tone]}`}>
                    {entry.title}
                  </span>
                  {entry.http !== undefined && (
                    <span className="shrink-0 rounded-md bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted tabular">
                      {entry.http === 0 ? 'no answer' : entry.http}
                      {entry.ms !== undefined && ` · ${formatMs(entry.ms)}`}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs leading-snug text-muted">{entry.detail}</p>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function Primary({
  icon: Icon,
  spin,
  disabled,
  onClick,
  children,
}: {
  icon: LucideIcon;
  spin?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      whileHover={disabled ? undefined : { y: -2 }}
      whileTap={{ scale: 0.97 }}
      disabled={disabled}
      onClick={onClick}
      className="sheen flex w-full items-center justify-center gap-2 rounded-2xl bg-you py-3.5 font-display text-[17px] font-semibold text-white shadow-[0_12px_28px_-10px_rgb(122_60_243/0.6)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
    >
      <Icon className={`size-4.5 ${spin ? 'animate-spin' : ''}`} />
      {children}
    </motion.button>
  );
}

function Again({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-line py-2.5 text-sm font-semibold text-ink transition hover:border-ink"
    >
      <RotateCcw className="size-4 transition-transform duration-500 group-hover:-rotate-180" /> Buy
      again
    </button>
  );
}

function Working({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2.5 rounded-2xl bg-panel-2 px-3 py-7 text-sm font-medium text-ink">
      <Loader2 className="size-5 animate-spin text-you" />
      {children}
    </div>
  );
}

function Notice({ tone, children }: { tone: 'bad' | 'warn' | 'info'; children: ReactNode }) {
  const color =
    tone === 'bad'
      ? 'bg-bad/10 text-bad-ink'
      : tone === 'warn'
        ? 'bg-warn/15 text-warn-ink'
        : 'bg-panel-2 text-muted';
  return (
    <div className={`flex gap-2 rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${color}`}>
      {tone !== 'info' && <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}
