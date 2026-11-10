import { Check, Copy, Plug, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { checkLocalBackend, setConnected, type LocalCheck } from '../lib/live/endpoints';

const BACKEND_REPO = 'https://github.com/DevAndroidify/ticketsurge';

type Status = 'idle' | 'checking' | LocalCheck;

/**
 * "Connect my backend": the visitor runs the backend on their own machine, and this page talks to
 * it on localhost. Nothing goes through our servers, so a hosted copy of the site needs none.
 */
export function ConnectPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<Status>('idle');
  const origin = location.origin;
  const corsLine = `CORS_ORIGINS=${origin}`;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const connect = async () => {
    setStatus('checking');
    const result = await checkLocalBackend();
    setStatus(result);
    if (result === 'ok') {
      setConnected(true);
      location.reload();
    }
  };

  const steps: { text: string; command: string }[] = [
    { text: 'Clone the backend', command: `git clone ${BACKEND_REPO} && cd ticketsurge` },
    { text: 'Install and copy the settings', command: 'npm install && cp .env.example .env' },
    { text: 'In .env, allow this site', command: corsLine },
    { text: 'Start Docker: PostgreSQL, Redis, Kafka', command: 'npm run infra:up' },
    {
      text: 'Build, create the tables and the demo event',
      command: 'npm run build && npm run db:migrate && npm run db:seed && npm run kafka:topics',
    },
    { text: 'Start all eight services', command: 'npm run dev:all' },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
            className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-3xl bg-panel p-6 shadow-lift"
            initial={{ y: 24, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="connect-title"
                  className="font-display text-2xl font-bold tracking-tight text-ink"
                >
                  Connect my backend
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Run TicketSurge on your machine and this page drives it: real Kafka, Redis and
                  PostgreSQL. Everything stays on your computer.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1.5 text-muted transition hover:bg-panel-2 hover:text-ink"
              >
                <X className="size-5" />
              </button>
            </div>

            <ol className="mt-5 space-y-3">
              {steps.map((step, i) => (
                <li key={step.command} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-panel-2 text-xs font-bold text-ink">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{step.text}</div>
                    <CommandLine command={step.command} />
                  </div>
                </li>
              ))}
            </ol>

            <p className="mt-4 text-xs leading-relaxed text-muted">
              Chrome and Edge ask once to let this site reach devices on your network: choose Allow.
              Safari may block a secure page from reaching localhost, so use Chrome, Edge or
              Firefox.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void connect()}
                disabled={status === 'checking'}
                className="sheen inline-flex items-center gap-2 rounded-xl bg-you px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-you-ink disabled:opacity-60"
              >
                <Plug className="size-4" />
                {status === 'checking' ? 'Checking localhost:3000…' : 'Connect'}
              </button>
              <StatusMessage status={status} corsLine={corsLine} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StatusMessage({ status, corsLine }: { status: Status; corsLine: string }) {
  if (status === 'down') {
    return (
      <span className="text-sm text-bad-ink">
        Nothing answers on localhost:3000. Is <code className="font-mono">npm run dev:all</code>{' '}
        running?
      </span>
    );
  }
  if (status === 'cors') {
    return (
      <span className="text-sm text-warn-ink">
        Your API is running but does not allow this site. Add{' '}
        <code className="font-mono">{corsLine}</code> to .env and restart{' '}
        <code className="font-mono">dev:all</code>.
      </span>
    );
  }
  if (status === 'ok') return <span className="text-sm text-ok-ink">Connected. Reloading…</span>;
  return null;
}

function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1 flex items-center gap-2 rounded-lg bg-ink px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap text-white">
        {command}
      </code>
      <button
        type="button"
        aria-label={`Copy: ${command}`}
        onClick={() => {
          void navigator.clipboard
            .writeText(command)
            .then(() => {
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
              }, 1500);
            })
            .catch(() => undefined);
        }}
        className="shrink-0 rounded p-1 text-white/60 transition hover:text-white"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
