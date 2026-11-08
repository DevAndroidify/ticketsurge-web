import { ExternalLink, Radio, Ticket } from 'lucide-react';
import type { Mode } from '../lib/types';

const BACKEND_REPO = 'https://github.com/DevAndroidify/ticketsurge';

export function Header({ mode }: { mode: Mode }) {
  const other = mode === 'live' ? 'sim' : 'live';
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-http to-[#8b5cf6] shadow-[0_0_24px_rgb(107_147_255/0.4)]">
          <Ticket className="size-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">TicketSurge</h1>
          <p className="text-xs text-muted">
            Flash-sale backend · Kafka, Redis and PostgreSQL under a traffic spike
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium ${
            mode === 'live'
              ? 'border-ok/40 bg-ok/10 text-ok'
              : 'border-kafka/40 bg-kafka/10 text-kafka'
          }`}
        >
          <Radio className="size-3.5" />
          {mode === 'live' ? 'Live · your local backend' : 'Simulated · runs in your browser'}
        </span>
        <a
          href={`?mode=${other}`}
          className="rounded-full border border-line px-3 py-1 text-muted transition hover:border-faint hover:text-ink"
        >
          Switch to {other === 'live' ? 'live' : 'simulated'}
        </a>
        {mode === 'live' && (
          <>
            <HeaderLink href={__GRAFANA_URL__}>Grafana</HeaderLink>
            <HeaderLink href={__KAFKA_UI_URL__}>Kafka UI</HeaderLink>
          </>
        )}
        <HeaderLink href={BACKEND_REPO}>Backend source</HeaderLink>
      </div>
    </header>
  );
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1 rounded-full border border-line px-3 py-1 text-muted transition hover:border-faint hover:text-ink"
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}
