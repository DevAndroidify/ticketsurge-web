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
      className="xl:sticky xl:top-4"
    >
      <Track step={step} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={stageKey(step)}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className="mt-4"
        >
          {step === 'idle' && (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-muted">
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
                <p className="text-center text-[11px] text-faint">Waiting for the API to be up…</p>
              )}
              {error && <Notice tone="bad">{error}</Notice>}
            </div>
          )}

          {step === 'signing-in' && <Working>Creating your account…</Working>}

          {step === 'queued' && (
            <div className="py-2 text-center">
              <div className="text-[11px] tracking-wider text-muted uppercase">
                Your place in line
              </div>
              <div className="my-1 text-5xl font-semibold text-redis">
                {buyer?.position === undefined ? (
                  '…'
                ) : (
                  <>
                    #<Ticker value={buyer.position} format={formatInt} />
                  </>
                )}
              </div>
              <div className="flex items-center justify-center gap-1.5 text-xs text-muted">
                <Loader2 className="size-3 animate-spin" />
                Admitted in batches by the admission worker
              </div>
            </div>
          )}

          {(step === 'picking' || step === 'holding') && (
            <div className="space-y-3">
              {selected.length === 0 ? (
                <div className="rounded-xl border border-dashed border-you/50 bg-you/5 px-3 py-4 text-center text-xs text-ink">
                  <Armchair className="mx-auto mb-1.5 size-5 text-you" />
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
                className="w-full rounded-lg py-1.5 text-xs text-muted transition hover:text-ink"
              >
                Let them go
              </button>
              <p className="text-center text-[11px] text-faint">
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
            <div className="space-y-3">
              <Notice tone={step === 'released' ? 'info' : 'bad'}>
                {buyer?.message ?? 'The purchase ended.'}
              </Notice>
              <Again onReset={onReset} />
            </div>
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
          <li key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="relative flex w-full items-center justify-center">
              {index > 0 && (
                <span className="absolute top-1/2 right-1/2 left-[-50%] h-px -translate-y-1/2 bg-line">
                  <motion.span
                    className="block h-full origin-left bg-you"
                    initial={false}
                    animate={{ scaleX: index <= current || step === 'confirmed' ? 1 : 0 }}
                    transition={{ duration: 0.35 }}
                  />
                </span>
              )}
              <motion.span
                initial={false}
                animate={{ scale: active ? 1.15 : 1 }}
                className={`relative grid size-5 place-items-center rounded-full border text-[10px] leading-none font-semibold transition-colors ${
                  active && failed
                    ? 'border-bad bg-bad text-white'
                    : active
                      ? 'border-you bg-you text-white'
                      : done
                        ? 'border-you bg-you/25 text-you'
                        : 'border-line bg-panel-2 text-faint'
                }`}
              >
                {done ? <Check className="size-3" /> : index + 1}
              </motion.span>
            </div>
            <span className={`truncate text-[10px] ${active || done ? 'text-ink' : 'text-faint'}`}>
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
    <div className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/60 p-3">
      <div className="relative size-16 shrink-0">
        <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth="5"
          />
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke={urgent ? 'var(--color-bad)' : 'var(--color-you)'}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center font-mono text-xs text-ink tabular">
          {seconds >= 60
            ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
            : `${seconds}s`}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        <span className="font-medium text-ink">These seats are yours for now.</span> Nobody else can
        take them until the Redis TTL runs out.
      </p>
    </div>
  );
}

function SeatList({ seats }: { seats: readonly SeatCell[] }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/60 p-3">
      <ul className="space-y-1">
        {seats.map((seat) => (
          <li key={seat.id} className="flex justify-between text-xs">
            <span
              className={
                seat.status === 'available' || seat.status === 'held' ? 'text-ink' : 'text-muted'
              }
            >
              {seatLabel(seat)}
            </span>
            <span className="font-mono text-muted tabular">{formatMoney(seat.priceMinor)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-between border-t border-line pt-2 text-xs font-semibold">
        <span>Total</span>
        <span className="font-mono tabular">{formatMoney(total(seats))}</span>
      </div>
    </div>
  );
}

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
    <div className="relative" style={{ perspective: 700 }}>
      <Burst />
      <motion.div
        initial={{ rotateX: -75, opacity: 0, y: 24 }}
        animate={{ rotateX: 0, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 130, damping: 14 }}
        className="relative overflow-hidden rounded-2xl border border-ok/40 bg-gradient-to-br from-ok/20 via-panel-2 to-you/20 p-4"
      >
        <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-ok uppercase">
          <Check className="size-3.5" /> Confirmed
        </div>
        <div className="mt-1.5 text-sm font-semibold text-ink">{event?.name}</div>
        <div className="text-[11px] text-muted">{event?.venue}</div>
        <div className="my-3 border-t border-dashed border-line" />
        <div className="flex flex-wrap gap-1.5">
          {seats.map((seat) => (
            <span
              key={seat.id}
              className="rounded-md bg-ok/15 px-2 py-0.5 font-mono text-[11px] text-ok"
            >
              {seatLabel(seat)}
            </span>
          ))}
        </div>
        <div className="mt-3 truncate font-mono text-[10px] text-faint">Booking {bookingId}</div>
      </motion.div>
    </div>
  );
}

const SPARKS = Array.from({ length: 20 }, (_, i) => {
  const angle = (i / 20) * Math.PI * 2;
  const reach = 70 + ((i * 37) % 60);
  return {
    x: Math.cos(angle) * reach * 1.4,
    y: Math.sin(angle) * reach,
    color: ['bg-ok', 'bg-you', 'bg-kafka', 'bg-http'][i % 4],
  };
});

function Burst() {
  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 z-10" aria-hidden>
      {SPARKS.map((spark, i) => (
        <motion.span
          key={i}
          className={`absolute size-1.5 rounded-full ${spark.color ?? 'bg-ok'}`}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: spark.x, y: spark.y, opacity: 0, scale: 0.4 }}
          transition={{ duration: 0.95, ease: 'easeOut', delay: 0.05 }}
        />
      ))}
    </div>
  );
}

function Timeline({ log }: { log: readonly JourneyEntry[] }) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2.5 text-xs font-semibold text-ink">What just happened</h3>
      <ul className="space-y-2.5">
        <AnimatePresence initial={false}>
          {log.slice(0, 6).map((entry) => (
            <motion.li
              key={entry.id}
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex gap-2"
            >
              <span className={`mt-1 size-2 shrink-0 rounded-full ${TECH_DOT[entry.tech]}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`text-xs font-medium ${
                      entry.tone === 'bad'
                        ? 'text-bad'
                        : entry.tone === 'warn'
                          ? 'text-warn'
                          : entry.tone === 'good'
                            ? 'text-ok'
                            : 'text-ink'
                    }`}
                  >
                    {entry.title}
                  </span>
                  {entry.http !== undefined && (
                    <span className="shrink-0 font-mono text-[10px] text-faint tabular">
                      {entry.http === 0 ? 'no answer' : entry.http}
                      {entry.ms !== undefined && ` · ${formatMs(entry.ms)}`}
                    </span>
                  )}
                </div>
                <p className="text-[11px] leading-snug text-muted">{entry.detail}</p>
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
      whileTap={{ scale: 0.98 }}
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-you py-2.5 text-sm font-semibold text-white shadow-[0_0_28px_rgb(168_122_255/0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
    >
      <Icon className={`size-4 ${spin ? 'animate-spin' : ''}`} />
      {children}
    </motion.button>
  );
}

function Again({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2 text-xs font-medium text-ink transition hover:border-faint"
    >
      <RotateCcw className="size-3.5" /> Buy again
    </button>
  );
}

function Working({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-line bg-panel-2/60 px-3 py-6 text-xs text-ink">
      <Loader2 className="size-4 animate-spin text-you" />
      {children}
    </div>
  );
}

function Notice({ tone, children }: { tone: 'bad' | 'warn' | 'info'; children: ReactNode }) {
  const color =
    tone === 'bad'
      ? 'border-bad/30 bg-bad/10 text-bad'
      : tone === 'warn'
        ? 'border-warn/30 bg-warn/10 text-warn'
        : 'border-line bg-panel-2 text-muted';
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${color}`}>
      {tone !== 'info' && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}
