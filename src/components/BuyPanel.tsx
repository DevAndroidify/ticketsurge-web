import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { MAX_SEATS, type JourneySnapshot, type JourneyStep } from '../lib/buyer/journey';
import { formatMoney } from '../lib/format';
import type { SaleEvent } from '../lib/types';
import type { SalePhase, SeatCell } from '../state/dashboard';
import { useNow } from './useNow';

const STEPS: { label: (max: number) => string; steps: readonly JourneyStep[] }[] = [
  { label: () => 'Join the line', steps: ['signing-in'] },
  { label: () => 'Get let in', steps: ['queued'] },
  { label: (max) => `Hold up to ${max} seats`, steps: ['picking', 'holding'] },
  { label: () => 'Pay, get your ticket', steps: ['held', 'booking', 'paying'] },
];

const ENDED: readonly JourneyStep[] = ['cancelled', 'expired', 'hold-lost', 'released', 'error'];

const seatName = (seat: SeatCell) => `${seat.section} ${seat.row}${seat.number}`;

/** "You're in line": the visitor's own purchase, through the same API as the crowd. */
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
  // The last refusal from the API, so a lost race reads as a 409 rather than a vague failure.
  const refusal = buyer?.log.find((e) => e.http === 409 || e.http === 429);

  return (
    <div className="flex flex-col gap-4">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={stageKey(step)}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col gap-4"
        >
          {step === 'idle' && (
            <>
              <h2 className="m-0 text-[22px] font-semibold">Get a ticket yourself</h2>
              <p className="m-0 text-base leading-normal text-muted">
                {event
                  ? `Join ${event.name}. If a crowd is running, you queue behind it.`
                  : 'Opens a sale with nobody else in it. Send in a crowd whenever you like, and race it for seats.'}
              </p>
            </>
          )}

          {step === 'signing-in' && (
            <>
              <h2 className="m-0 text-[22px] font-semibold">Joining the line</h2>
              <p className="m-0 text-base text-muted">Making you an account first…</p>
            </>
          )}

          {step === 'queued' && <InLine buyer={buyer} />}

          {(step === 'picking' || step === 'holding') && (
            <>
              <h2 className="m-0 text-[22px] font-semibold">You&apos;re in. Pick your seats.</h2>
              <Huge>
                {selected.length}
                <Small>/{MAX_SEATS}</Small>
              </Huge>
              <p className="m-0 text-base leading-normal text-muted">
                {selected.length === 0
                  ? `Click up to ${MAX_SEATS} open seats on the map.`
                  : selected.map(seatName).join(', ')}
              </p>
              {selected.some((s) => s.status !== 'available') && (
                <p className="m-0 text-base text-error">
                  One of your seats was just taken. Hold anyway to see the 409, or click it to drop
                  it.
                </p>
              )}
            </>
          )}

          {step === 'held' && buyer?.holdExpiresAt !== undefined && (
            <>
              <h2 className="m-0 text-[22px] font-semibold">Seats held. Now pay.</h2>
              <Countdown expiresAt={buyer.holdExpiresAt} />
              <p className="m-0 text-base leading-normal text-muted">
                {yours.map(seatName).join(', ')}. Pay before the hold runs out, or the seats go back
                on sale. Payment is simulated and sometimes declines.
              </p>
            </>
          )}

          {(step === 'booking' || step === 'paying') && (
            <>
              <h2 className="m-0 text-[22px] font-semibold">Paying</h2>
              <p className="m-0 text-base leading-normal text-muted">
                {step === 'booking'
                  ? 'Saving your booking in PostgreSQL…'
                  : 'Booked. Kafka has handed it to the payment service; waiting for the result…'}
              </p>
            </>
          )}

          {step === 'confirmed' && (
            <>
              <h2 className="m-0 text-[22px] font-semibold">You&apos;re going.</h2>
              <Huge>
                {yours.length}
                <Small>{yours.length === 1 ? ' ticket' : ' tickets'}</Small>
              </Huge>
              <p className="m-0 text-base leading-normal">
                {yours.map(seatName).join(', ')} · {formatMoney(total(yours))}
              </p>
              {buyer?.bookingId && (
                <p className="m-0 text-sm text-muted">
                  Booking <span className="font-mono">{buyer.bookingId.slice(0, 8)}</span>
                </p>
              )}
            </>
          )}

          {ENDED.includes(step) && (
            <>
              <h2 className="m-0 text-[22px] font-semibold">No ticket this time</h2>
              <p className="m-0 text-base leading-normal text-muted">
                {buyer?.message ?? 'The purchase ended.'}
              </p>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {step === 'picking' && buyer?.message && (
        <motion.p
          key={refusal?.id}
          initial={{ x: -6 }}
          animate={{ x: 0 }}
          className="m-0 border-l-2 border-error pl-3 text-base text-error"
        >
          {refusal?.http ? `${refusal.http}: ` : ''}
          {buyer.message}
        </motion.p>
      )}

      {step !== 'idle' && <Steps step={step} />}

      <Action
        step={step}
        selected={selected.length}
        price={total(yours)}
        canStart={canStart}
        preparing={phase === 'preparing'}
        onStart={onStart}
        onHold={onHold}
        onPay={onPay}
        onRelease={onRelease}
        onReset={onReset}
      />
      {step === 'idle' && !canStart && (
        <p className="m-0 text-sm text-muted">Waiting for the API to answer…</p>
      )}
      {step === 'idle' && error && (
        <p className="m-0 border-l-2 border-ink pl-3 text-[15px] leading-normal">{error}</p>
      )}
    </div>
  );
}

function InLine({ buyer }: { buyer: JourneySnapshot | undefined }) {
  const position = buyer?.position;
  // The place the visitor joined at, from the journey log, so progress needs no extra state.
  const joined = buyer?.log
    .map((e) => /waiting room at #(\d+)/.exec(e.title)?.[1])
    .find((n) => n !== undefined);
  const start = Math.max(Number(joined ?? position ?? 1), position ?? 1);
  const ahead = Math.max(0, (position ?? start) - 1);
  const filled =
    position === undefined ? 0 : Math.round(20 * (1 - ahead / Math.max(1, start - 1 || 1)));
  return (
    <>
      <h2 className="m-0 text-[22px] font-semibold">You&apos;re in line</h2>
      <Huge>
        {position === undefined ? '…' : position}
        {position !== undefined && <Small>{ordinal(position)}</Small>}
      </Huge>
      <p className="m-0 text-base leading-normal text-muted">
        {position === undefined
          ? 'Finding your place…'
          : ahead === 0
            ? 'You are at the front. You will be let in with the next batch.'
            : `${ahead} ${ahead === 1 ? 'person' : 'people'} ahead of you. The line lets people in a batch at a time.`}
      </p>
      <div
        role="img"
        aria-label={`${filled} of 20 steps to the front`}
        className="grid grid-cols-20 gap-[3px]"
      >
        {Array.from({ length: 20 }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 transition-colors duration-300 ${i < filled ? 'bg-accent' : 'bg-sold'}`}
          />
        ))}
      </div>
    </>
  );
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const now = useNow();
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return (
    <Huge>
      {minutes > 0 ? `${minutes}:${String(seconds % 60).padStart(2, '0')}` : seconds}
      <Small>{minutes > 0 ? ' left' : 's left'}</Small>
    </Huge>
  );
}

function Steps({ step }: { step: JourneyStep }) {
  const current = STEPS.findIndex((s) => s.steps.includes(step));
  const confirmed = step === 'confirmed';
  return (
    <ol className="m-0 mt-1 flex list-none flex-col p-0 text-base">
      {STEPS.map((item, i) => {
        const done = confirmed || (current >= 0 && i < current);
        const active = !confirmed && i === current;
        return (
          <li
            key={i}
            className={`flex items-center gap-3.5 border-t border-line py-2.5 last:border-b ${
              active ? 'font-semibold' : 'text-muted'
            }`}
          >
            <span className={`w-[18px] font-semibold ${active ? 'text-accent-text' : ''}`}>
              {i + 1}
            </span>
            <span className={done ? 'line-through' : ''}>{item.label(MAX_SEATS)}</span>
            {active && <span className="ml-auto text-sm font-normal text-accent-text">now</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Action({
  step,
  selected,
  price,
  canStart,
  preparing,
  onStart,
  onHold,
  onPay,
  onRelease,
  onReset,
}: {
  step: JourneyStep;
  selected: number;
  price: number;
  canStart: boolean;
  preparing: boolean;
  onStart: () => void;
  onHold: () => void;
  onPay: () => void;
  onRelease: () => void;
  onReset: () => void;
}) {
  if (step === 'idle') {
    return (
      <Button primary disabled={!canStart || preparing} onClick={onStart}>
        {preparing ? 'Opening the sale…' : 'Get in line'}
      </Button>
    );
  }
  if (step === 'picking' || step === 'holding') {
    return (
      <Button primary disabled={selected === 0 || step === 'holding'} onClick={onHold}>
        {step === 'holding'
          ? 'Asking Redis…'
          : selected === 0
            ? 'Pick seats on the map'
            : `Hold ${selected} seat${selected === 1 ? '' : 's'}`}
      </Button>
    );
  }
  if (step === 'held') {
    return (
      <div className="flex flex-col gap-2">
        <Button primary onClick={onPay}>
          Pay {formatMoney(price)}
        </Button>
        <Button onClick={onRelease}>Let them go</Button>
      </div>
    );
  }
  if (step === 'confirmed' || ENDED.includes(step)) {
    return <Button onClick={onReset}>{step === 'confirmed' ? 'Get another' : 'Try again'}</Button>;
  }
  return <Button disabled>{step === 'queued' ? 'Hang on, nearly your turn…' : 'Hang on…'}</Button>;
}

function Button({
  primary = false,
  disabled = false,
  onClick,
  children,
}: {
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-12 px-5 text-[15px] transition-[filter,background-color] disabled:cursor-not-allowed ${
        primary
          ? 'border-0 bg-accent font-semibold text-on-accent hover:brightness-95 disabled:bg-sold disabled:text-muted'
          : 'border border-ink bg-transparent font-medium text-ink hover:bg-tint disabled:hover:bg-transparent'
      }`}
    >
      {children}
    </button>
  );
}

function Huge({ children }: { children: ReactNode }) {
  return (
    <div className="text-[104px] leading-[0.82] font-semibold tracking-[-0.03em] tabular">
      {children}
    </div>
  );
}

function Small({ children }: { children: ReactNode }) {
  return <span className="align-top text-4xl tracking-normal">{children}</span>;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

/** One screen can cover several steps; only a change of screen should animate. */
function stageKey(step: JourneyStep): string {
  if (step === 'picking' || step === 'holding') return 'picking';
  if (step === 'booking' || step === 'paying') return 'paying';
  if (ENDED.includes(step)) return 'ended';
  return step;
}

function total(seats: readonly SeatCell[]) {
  return seats.reduce((sum, seat) => sum + seat.priceMinor, 0);
}
