import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import type { Activity } from '../lib/bots/swarm';
import { formatInt, formatRate } from '../lib/format';
import type { DashboardState } from '../state/dashboard';
import { feedLines, type FeedTone } from './feed';
import { SOURCE_URL } from './Header';
import {
  CROWD_GROUPS,
  crowdGroups,
  finishedSentence,
  formatDuration,
  percent,
  saleNumbers,
  type SaleNumbers,
  type CrowdGroup,
} from './summary';
import { Ticker } from './ui';
import { useNow } from './useNow';

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
  const n = saleNumbers(state);
  const started = n.seats > 0;
  return (
    <section aria-label="Live counters" className="flex flex-wrap border-t border-ink">
      <Counter
        label="Waiting in line"
        value={n.waiting}
        sub={n.buyers > 0 ? `of ${formatInt(n.buyers)} buyers` : 'nobody yet'}
        grow="flex-[1.2_1_200px]"
      />
      <Counter
        label="Seats left"
        value={n.left}
        sub={started ? `of ${formatInt(n.seats)} seats` : 'no sale yet'}
        grow="flex-[1_1_180px]"
      />
      <Counter
        label="Booked"
        value={n.booked}
        sub={started ? `${percent(n.booked, n.seats)}% of the house` : '–'}
        grow="flex-[1_1_180px]"
      />
      <div className="flex flex-[1.6_1_320px] items-center justify-between gap-4 bg-accent px-4 py-5 text-on-accent sm:px-8">
        <div className="flex flex-col gap-2">
          <span className="text-sm">Seats sold twice</span>
          <span className="text-[56px] leading-none font-medium tabular">
            <Ticker value={n.twice} format={formatInt} />
          </span>
          <span className="text-sm tabular">
            {formatInt(n.refused)} {n.refused === 1 ? 'attempt' : 'attempts'} refused with a 409
          </span>
        </div>
        <Note className="max-w-[170px] -rotate-3 leading-[1.05]">
          should always be zero. try to break it.
        </Note>
      </div>
    </section>
  );
}

function Counter({
  label,
  value,
  sub,
  grow,
}: {
  label: string;
  value: number;
  sub: string;
  grow: string;
}) {
  return (
    <div className={`${grow} flex flex-col gap-2 border-r border-line px-4 py-5 sm:px-7`}>
      <span className="text-sm text-muted">{label}</span>
      <span className="text-[56px] leading-none font-medium tabular">
        <Ticker value={value} format={formatInt} />
      </span>
      <span className="text-sm text-muted tabular">{sub}</span>
    </div>
  );
}

const GROUP_LOOK: Record<CrowdGroup, string> = {
  line: 'bg-ink',
  trying: 'seat-held',
  got: 'bg-accent',
  missed: 'bg-sold',
};

/**
 * One line on what the sale is doing right now, and where every buyer is. Below the counters, so
 * the numbers above it have a story.
 */
export function SaleStatus({ state }: { state: DashboardState }) {
  const { phase, swarm } = state.sale;
  const n = saleNumbers(state);
  const running = phase === 'running';
  const now = useNow(running);
  const groups = swarm ? crowdGroups(swarm.phases) : undefined;
  const total = groups ? groups.line + groups.trying + groups.got + groups.missed : 0;
  const rps = Math.max(state.metrics?.http.total ?? 0, state.clientRps);
  // A finished sale ends with the swarm's last log line.
  const endedAt = swarm?.activity[0]?.at ?? now;

  let text: string;
  if (phase === 'preparing') text = 'Opening the sale…';
  else if (running && swarm) {
    text = `Sale running for ${formatDuration(now - swarm.startedAt)} · ${formatRate(rps)} requests a second · ${formatInt(n.refused)} refused with a 409 · ${formatInt(n.slowedDown)} told to slow down with a 429.`;
  } else if (phase === 'finished' && swarm && groups) {
    text = finishedSentence({
      ms: endedAt - swarm.startedAt,
      sold: n.booked,
      seats: n.seats,
      buyers: n.buyers,
      got: groups.got,
      refused: n.refused,
      twice: n.twice,
    });
  } else if (phase === 'open') {
    text = 'The sale is open with nobody else in it. Send in the crowd whenever you like.';
  } else {
    text =
      'No sale yet. Start one from the header, or get in line yourself and race the crowd later.';
  }

  return (
    <section
      aria-label="Sale status"
      className="flex flex-col gap-3 border-y border-ink px-4 py-4 sm:px-8"
    >
      <p className="m-0 flex items-baseline gap-2.5 text-[15px] leading-normal">
        <span
          className={`size-2 flex-none translate-y-[-1px] ${running ? 'live-blink bg-accent' : 'bg-sold'}`}
        />
        <span>{text}</span>
      </p>
      {groups && total > 0 && (
        <div className="flex flex-col gap-2">
          <div
            role="img"
            aria-label={CROWD_GROUPS.map((g) => `${g.label}: ${groups[g.id]}`).join(', ')}
            className="flex h-2.5 gap-[2px]"
          >
            {CROWD_GROUPS.map((g) =>
              groups[g.id] > 0 ? (
                <span
                  key={g.id}
                  className={`${GROUP_LOOK[g.id]} transition-[flex-grow] duration-500`}
                  style={{ flexGrow: groups[g.id] }}
                />
              ) : null,
            )}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            {CROWD_GROUPS.map((g) => (
              <span key={g.id} className="flex items-center gap-2 tabular">
                <span className={`size-2.5 ${GROUP_LOOK[g.id]}`} />
                {g.label} <span className="text-ink">{formatInt(groups[g.id])}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
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

interface Step {
  title: string;
  /** What happens, in plain words. */
  text: (simulated: boolean) => string;
  /** Where to see it on this page. */
  look: string;
  tech: string;
  /** This sale's evidence for the step, once a crowd has run. */
  evidence: (n: SaleNumbers) => string;
}

/** One ticket's path, from "Get in line" to the seat turning grey. Facts from the backend's brief. */
const STEPS: Step[] = [
  {
    title: 'You join one line.',
    text: () =>
      'Every buyer gets a place in a single queue, kept in Redis. An admission worker lets the next batch in at a steady rate, so the seats are never stampeded all at once.',
    look: "You're in line, and Waiting in line at the top.",
    tech: 'Redis · admission worker',
    evidence: (n) => `${formatInt(n.waiting)} in line now`,
  },
  {
    title: 'Clicking too fast gets a 429.',
    text: () =>
      'Each buyer has a small allowance of requests every 10 seconds, also counted in Redis. Go over it and the API answers 429 Too Many Requests. The bots wait a moment and try again.',
    look: 'The 429 band in Requests per second.',
    tech: 'Redis',
    evidence: (n) => `${formatInt(n.slowedDown)} told to slow down`,
  },
  {
    title: 'Holding seats is all or nothing.',
    text: (simulated) =>
      `One Lua script checks that you were let in and that every seat you chose is free, then claims them all in a single step. If even one is taken, it changes nothing and the API answers 409 Conflict. A hold lasts ${simulated ? '45 seconds here' : '10 minutes by default'}: those are the striped seats.`,
    look: "Striped seats in the venue, and the 409 in You're in line.",
    tech: 'Redis · Lua',
    evidence: (n) => `${formatInt(n.refused)} refused with a 409`,
  },
  {
    title: 'PostgreSQL makes the final call.',
    text: () =>
      'Booking writes three things in one database transaction: the booking, waiting for payment; its seats; and a message to send afterwards, called the outbox. A unique index allows one active booking per seat, so even if Redis were wrong, no seat could be sold twice. Each booking carries an idempotency key, so one sent twice comes back as the same booking.',
    look: 'Seats sold twice, which must stay 0.',
    tech: 'PostgreSQL',
    evidence: (n) =>
      `${formatInt(n.twice)} sold twice · ${formatInt(n.replays)} repeat ${n.replays === 1 ? 'request' : 'requests'} caught`,
  },
  {
    title: 'Kafka carries the rest.',
    text: () =>
      'The API answers straight away with 202 Accepted. A relay then moves the outbox message onto Kafka, and the payment, ticket and notification services each pick it up in their own time. Kafka may deliver a message twice, so every service records the messages it has already handled.',
    look: 'Kafka consumers, in the control room.',
    tech: 'Kafka · outbox relay',
    evidence: (n) =>
      `${formatInt(n.lag)} ${n.lag === 1 ? 'message' : 'messages'} waiting in Kafka now`,
  },
  {
    title: 'Every booking ends exactly one way.',
    text: () =>
      'Payment is simulated, and about one in ten is declined. A paid booking is confirmed, then gets its tickets and a notification. A declined one is cancelled and its seats go back on sale. With no answer before the deadline, a sweeper expires it. Each change only applies to a booking that is still waiting, so two outcomes can never both win.',
    look: "Got tickets and Didn't get one, under the counters.",
    tech: 'Payment · booking saga',
    evidence: (n) => `${formatInt(n.got)} got tickets, ${formatInt(n.missed)} didn't`,
  },
  {
    title: 'The map updates itself.',
    text: () =>
      'Every seat change is published on a Redis channel. The realtime gateway forwards it to your browser over a WebSocket, which is how seats turn striped or grey without a reload. Redis channels keep no history, so the page also reloads the map every few seconds and after reconnecting.',
    look: "Tonight's venue.",
    tech: 'Redis Pub/Sub · WebSocket',
    evidence: (n) => `WebSocket ${n.socket}`,
  },
];

const WORDS: [term: string, meaning: string][] = [
  ['Hold', "Seats kept for you while you pay. They go back on sale if you don't."],
  ['409 Conflict', 'Someone got there first. Nothing was changed.'],
  ['429 Too Many Requests', 'Slow down, then try again.'],
  ['202 Accepted', 'The booking is saved. The rest happens in the background.'],
  [
    'Outbox',
    'Messages saved together with the booking and sent to Kafka afterwards, so none is lost.',
  ],
  ['Consumer lag', 'Messages waiting in Kafka that a service has not handled yet.'],
  ['Idempotency key', 'A label that makes sending the same request twice harmless.'],
];

export function HowItWorks({
  state,
  simulated,
  onControlRoom,
}: {
  state: DashboardState;
  simulated: boolean;
  onControlRoom: () => void;
}) {
  const n = saleNumbers(state);
  const ran = state.sale.swarm !== undefined;
  return (
    <section id="how-it-works" className="flex scroll-mt-16 flex-wrap border-b border-ink">
      <div className="flex min-w-0 flex-[2_1_640px] flex-col gap-6 border-b border-ink px-4 pt-10 pb-12 sm:px-8 lg:border-r lg:border-b-0">
        <div className="flex max-w-3xl flex-col gap-3">
          <h2 className="m-0 text-[clamp(2rem,4.5vw,3rem)] leading-[1.05] font-semibold tracking-[-0.02em]">
            How it works
          </h2>
          <p className="m-0 text-[17px] leading-[1.55]">
            What happens to one ticket, from the moment you press Get in line. Every buyer, bot or
            you, goes through the same seven steps.
          </p>
          <p className="m-0 text-[17px] leading-[1.55] text-muted">
            {simulated
              ? 'Right now a model in this tab plays the backend and follows the same rules. Connect your backend to run the real services.'
              : 'Right now these are the real services, running on your machine.'}
            {ran
              ? ' The numbers on the right are from this sale.'
              : ' Start a sale to see this sale’s numbers beside each step.'}
          </p>
        </div>
        <ol className="m-0 flex list-none flex-col p-0">
          {STEPS.map((step, i) => (
            <motion.li
              key={step.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.1, ease: [0.2, 0.8, 0.2, 1] }}
              className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-line py-5 last:border-b sm:grid-cols-[56px_minmax(0,1fr)_200px]"
            >
              <span className="text-[30px] leading-none font-medium text-accent-text tabular">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <h3 className="m-0 text-lg leading-snug font-semibold">{step.title}</h3>
                <p className="m-0 text-base leading-[1.6]">{step.text(simulated)}</p>
                <p className="m-0 text-sm text-muted">On this page: {step.look}</p>
              </div>
              <div className="col-start-2 flex flex-col gap-1 text-sm sm:col-start-auto sm:items-end sm:text-right">
                <span className="text-muted">{step.tech}</span>
                {ran && <span className="text-ink tabular">{step.evidence(n)}</span>}
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-8 bg-tint px-4 pt-10 pb-12 sm:px-8">
        <div className="flex flex-col gap-4">
          <h2 className="m-0 text-xl font-semibold">What it doesn&apos;t do</h2>
          <ul className="m-0 flex flex-col gap-2.5 pl-5 text-base leading-normal">
            <li>
              Take real money. Payments are simulated, and about one in ten is declined on purpose.
            </li>
            <li>Send real emails. Notifications are recorded, not delivered.</li>
            <li>Need a server to try. In simulated mode, everything runs in this tab.</li>
            <li>
              Pretend the bots are people. They&apos;re scripts, but they use the same API you do.
            </li>
            <li>
              Measure real capacity. Every bot runs in this browser tab, so the browser limits how
              hard the crowd can push. The backend&apos;s k6 load tests measure that.
            </li>
          </ul>
        </div>
        <div className="flex flex-col gap-4">
          <h2 className="m-0 text-xl font-semibold">Words on this page</h2>
          <dl className="m-0 flex flex-col">
            {WORDS.map(([term, meaning]) => (
              <div key={term} className="border-t border-ink/15 py-2.5 last:border-b">
                <dt className="text-[15px] font-semibold">{term}</dt>
                <dd className="m-0 text-[15px] leading-normal text-muted">{meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
        <button
          type="button"
          onClick={onControlRoom}
          className="self-start border-0 bg-transparent p-0 text-left text-base font-medium underline underline-offset-4 hover:opacity-75"
        >
          See it all happen in the control room
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
