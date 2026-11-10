import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Activity } from '../lib/bots/swarm';
import { formatInt } from '../lib/format';
import type { DashboardState } from '../state/dashboard';
import { feedLines, type FeedTone } from './feed';
import { SOURCE_URL } from './Header';
import { Ticker } from './ui';

/** Written in the margin. The page has at most three: the signature and two of these. */
export function Note({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-hand text-[24px] leading-[1.1] ${className}`}>{children}</span>;
}

export function Intro({ people, seats }: { people: number; seats: number }) {
  return (
    <section className="flex flex-wrap items-start gap-12 px-4 pt-14 pb-11 sm:px-8">
      <h1 className="m-0 flex-[3_1_560px] text-[clamp(2.4rem,6vw,3.75rem)] leading-[1.02] font-semibold tracking-[-0.02em]">
        What happens when {formatInt(people)} people want {formatInt(seats)} seats at the same
        second?
      </h1>
      <div className="flex max-w-[380px] flex-[1_1_300px] flex-col gap-3.5 pt-2.5">
        <p className="m-0 text-[17px] leading-[1.55]">
          I built TicketSurge to find out. The buyers here are bots. Connected to the backend, they
          hit the real Redis scripts, database rules and Kafka consumers; without it, a model in
          this tab follows the same rules.
        </p>
        <p className="m-0 text-[17px] leading-[1.55] text-muted">
          Press start, then try to get a seat yourself.
        </p>
        <Note className="origin-left -rotate-2 text-[26px] text-accent-text">— Sagar</Note>
      </div>
    </section>
  );
}

export function Counters({ state }: { state: DashboardState }) {
  const swarm = state.sale.swarm;
  const waiting = (swarm?.phases.queued ?? 0) + (state.buyer?.step === 'queued' ? 1 : 0);
  let left = 0;
  let booked = 0;
  for (const seat of state.sale.seats) {
    if (seat.status === 'available') left++;
    else if (seat.status === 'sold') booked++;
  }
  const twice = swarm?.doubleSold ?? 0;
  return (
    <section aria-label="Live counters" className="flex flex-wrap border-y border-ink">
      <Counter label="Waiting in line" value={waiting} grow="flex-[1.2_1_200px]" />
      <Counter label="Seats left" value={left} grow="flex-[1_1_180px]" />
      <Counter label="Booked" value={booked} grow="flex-[1_1_180px]" />
      <div className="flex flex-[1.6_1_320px] items-center justify-between gap-4 bg-accent px-4 py-5 text-on-accent sm:px-8">
        <div className="flex flex-col gap-2">
          <span className="text-sm">Seats sold twice</span>
          <span className="text-[56px] leading-none font-medium tabular">
            <Ticker value={twice} format={formatInt} />
          </span>
        </div>
        <Note className="max-w-[170px] -rotate-3 leading-[1.05]">
          should always be zero. try to break it.
        </Note>
      </div>
    </section>
  );
}

function Counter({ label, value, grow }: { label: string; value: number; grow: string }) {
  return (
    <div className={`${grow} flex flex-col gap-2 border-r border-line px-4 py-5 sm:px-7`}>
      <span className="text-sm text-muted">{label}</span>
      <span className="text-[56px] leading-none font-medium tabular">
        <Ticker value={value} format={formatInt} />
      </span>
    </div>
  );
}

const TONE: Record<FeedTone, string> = {
  ink: 'text-ink',
  muted: 'text-muted',
  error: 'text-error',
};

const SHOWN = 5;
/** At full traffic dozens of lines arrive each second; refreshing slower keeps them readable. */
const REFRESH_MS = 700;

/** "Just now": the latest things buyers went through, in plain sentences. */
export function JustNow({
  activity,
  startedAt,
}: {
  activity: readonly Activity[];
  startedAt: number | undefined;
}) {
  const latest = useRef({ activity, startedAt });
  const [shown, setShown] = useState(() => feedLines(activity.slice(0, SHOWN), startedAt));
  useEffect(() => {
    latest.current = { activity, startedAt };
  }, [activity, startedAt]);
  useEffect(() => {
    const timer = setInterval(() => {
      const { activity: now, startedAt: since } = latest.current;
      setShown((current) =>
        current[0]?.id === now[0]?.id && current.length === Math.min(SHOWN, now.length)
          ? current
          : feedLines(now.slice(0, SHOWN), since),
      );
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 mb-0.5 text-lg font-semibold">Just now</h2>
      {shown.length === 0 ? (
        <p className="m-0 text-[15px] text-muted">Quiet. Start a sale and this fills up.</p>
      ) : (
        shown.map((line) => (
          <div
            key={line.id}
            className="feed-in flex items-baseline gap-3 text-[15px] leading-[1.4]"
          >
            <span className="w-[54px] flex-none text-[13px] text-muted tabular">{line.time}</span>
            <span className={TONE[line.tone]}>{line.text}</span>
          </div>
        ))
      )}
    </div>
  );
}

const STEPS = [
  {
    title: 'Redis keeps the line fair.',
    text: 'Everyone joins one queue and gets let in in batches. Push too hard and you get a 429 and a short timeout.',
    tech: 'Redis',
  },
  {
    title: 'One click wins each seat.',
    text: 'A Lua script checks and claims a seat in a single step, so when six people click it, five get a 409. PostgreSQL has a unique index as a second line of defence.',
    tech: 'Redis, PostgreSQL',
  },
  {
    title: 'The slow stuff happens later.',
    text: 'Payment, tickets and emails go through Kafka, so the booking returns straight away.',
    tech: 'Kafka',
  },
];

export function HowItWorks({ onControlRoom }: { onControlRoom: () => void }) {
  return (
    <section id="how-it-works" className="flex scroll-mt-4 flex-wrap border-b border-ink">
      <div className="flex min-w-0 flex-[2_1_640px] flex-col gap-6 border-b border-ink px-4 pt-9 pb-11 sm:px-8 lg:border-r lg:border-b-0">
        <h2 className="m-0 text-[34px] font-semibold tracking-[-0.01em]">How it works, briefly</h2>
        <ol className="m-0 flex list-none flex-col p-0">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="grid grid-cols-[40px_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 border-t border-line py-[18px] last:border-b sm:grid-cols-[56px_minmax(0,1fr)_auto]"
            >
              <span className="text-[30px] font-medium text-accent-text">{i + 1}</span>
              <span className="text-[17px] leading-normal">
                <strong className="font-semibold">{step.title}</strong> {step.text}
              </span>
              <span className="col-start-2 text-sm text-muted sm:col-start-auto">{step.tech}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 bg-tint px-4 pt-9 pb-11 sm:px-8">
        <h2 className="m-0 text-xl font-semibold">What it doesn&apos;t do</h2>
        <ul className="m-0 flex flex-col gap-2.5 pl-5 text-base leading-normal">
          <li>Take real money. Payments are simulated.</li>
          <li>Need a server to try. In simulated mode, everything runs in this tab.</li>
          <li>
            Pretend the bots are people. They&apos;re scripts, but they use the same API you do.
          </li>
        </ul>
        <button
          type="button"
          onClick={onControlRoom}
          className="mt-1.5 self-start border-0 bg-transparent p-0 text-left text-base font-medium underline underline-offset-4 hover:opacity-75"
        >
          Open the control room to see every metric
        </button>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="flex flex-wrap justify-between gap-4 px-4 pt-6 pb-8 text-sm text-muted sm:px-8">
      <span>Built by Sagar with React, Node.js, Redis, PostgreSQL and Kafka.</span>
      <a
        href={SOURCE_URL}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-4 hover:opacity-75"
      >
        Read the code
      </a>
    </footer>
  );
}
