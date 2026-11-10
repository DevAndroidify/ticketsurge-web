import type { Endpoints } from '../lib/live/endpoints';

export const SOURCE_URL = 'https://github.com/DevAndroidify/ticketsurge';

export type Tab = 'sale' | 'how' | 'control';

const TABS: { id: Tab; label: string }[] = [
  { id: 'sale', label: 'The sale' },
  { id: 'how', label: 'How it works' },
  { id: 'control', label: 'Control room' },
];

export function Header({
  tab,
  onTab,
  endpoints,
  onConnect,
  onDisconnect,
  startLabel,
  canStart,
  onStart,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** Undefined in simulated mode. */
  endpoints?: Endpoints;
  onConnect: () => void;
  onDisconnect: () => void;
  startLabel: string;
  canStart: boolean;
  onStart: () => void;
}) {
  return (
    <header className="flex min-h-16 flex-wrap items-stretch justify-between gap-x-4 gap-y-2 border-b border-ink px-4 sm:px-8">
      <div className="flex flex-wrap items-stretch gap-x-10 gap-y-1">
        <a
          href="./"
          className="flex items-center gap-2.5 py-3 no-underline hover:opacity-75"
          onClick={(event) => {
            event.preventDefault();
            onTab('sale');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          <LogoMark />
          <span className="text-[19px] font-bold tracking-[-0.01em]">TicketSurge</span>
        </a>
        <nav
          aria-label="Main"
          className="flex flex-wrap items-stretch gap-x-7 text-[15px] font-medium"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => {
                onTab(t.id);
              }}
              className={`flex min-h-11 items-center border-0 bg-transparent p-0 transition-colors ${
                tab === t.id
                  ? 'text-ink shadow-[inset_0_-3px_0_var(--color-accent)]'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-2">
        <Connection endpoints={endpoints} onConnect={onConnect} onDisconnect={onDisconnect} />
        <a
          href={SOURCE_URL}
          className="text-[15px] underline underline-offset-4 hover:opacity-75"
          target="_blank"
          rel="noreferrer"
        >
          Source on GitHub
        </a>
        <button
          type="button"
          disabled={!canStart}
          onClick={onStart}
          className="min-h-11 border-0 bg-accent px-5 text-[15px] font-semibold text-on-accent transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-sold disabled:text-muted"
        >
          {startLabel}
        </button>
      </div>
    </header>
  );
}

/** Where the data comes from, and the way to change it. */
function Connection({
  endpoints,
  onConnect,
  onDisconnect,
}: {
  endpoints?: Endpoints;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const link =
    'border-0 bg-transparent p-0 text-[15px] underline underline-offset-4 hover:opacity-75';
  if (!endpoints) {
    return (
      <span className="flex items-center gap-2 text-sm text-muted">
        Simulated in this tab ·
        <button type="button" onClick={onConnect} className={`${link} text-ink`}>
          Connect my backend
        </button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-sm text-muted">
      <span className="live-blink size-2 bg-accent" />
      {endpoints.kind === 'direct' ? 'Live · your localhost ·' : 'Live · your local backend'}
      {endpoints.kind === 'direct' && (
        <button type="button" onClick={onDisconnect} className={`${link} text-ink`}>
          Disconnect
        </button>
      )}
    </span>
  );
}

export function LogoMark({ className = 'size-[22px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 22 22" aria-hidden="true" className={className}>
      <rect width="22" height="22" fill="var(--color-ink)" />
      <rect x="9" width="4" height="22" fill="var(--color-accent)" />
    </svg>
  );
}
