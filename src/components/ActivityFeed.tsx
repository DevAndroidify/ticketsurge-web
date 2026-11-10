import { useEffect, useRef, useState } from 'react';
import type { Activity, ActivityKind } from '../lib/bots/swarm';
import { Panel } from './ui';

const KIND: Record<ActivityKind, { text: string; dot: string }> = {
  info: { text: 'text-muted', dot: 'bg-faint' },
  success: { text: 'text-ok-ink', dot: 'bg-ok' },
  warn: { text: 'text-warn-ink', dot: 'bg-warn' },
  error: { text: 'text-bad-ink', dot: 'bg-bad' },
};

const SHOWN = 16;
/** At full traffic dozens of lines arrive each second; refreshing slower keeps them readable. */
const REFRESH_MS = 500;

/** Newest first. Each line slides in once (CSS, keyed by id); nothing animates on the way out. */
export function ActivityFeed({ activity }: { activity: Activity[] }) {
  const latest = useRef(activity);
  const [shown, setShown] = useState(() => activity.slice(0, SHOWN));
  useEffect(() => {
    latest.current = activity;
  }, [activity]);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = latest.current.slice(0, SHOWN);
      setShown((current) => (current[0]?.id === next[0]?.id ? current : next));
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <Panel title="Live activity" subtitle="What individual buyers just experienced" delay={0.18}>
      {shown.length === 0 ? (
        <div className="grid h-40 place-items-center rounded-2xl border-2 border-dashed border-line text-sm text-muted">
          Quiet. Launch a sale.
        </div>
      ) : (
        <ul className="max-h-[420px] space-y-0.5 overflow-hidden text-xs [mask-image:linear-gradient(to_bottom,black_75%,transparent)]">
          {shown.map((item) => {
            const kind = KIND[item.kind];
            return (
              <li key={item.id} className="feed-in flex items-center gap-2 rounded-md px-1 py-1">
                <span className={`size-1.5 shrink-0 rounded-full ${kind.dot}`} />
                <span className="shrink-0 font-mono text-[11px] font-semibold text-http-ink">
                  {item.bot}
                </span>
                <span className={`min-w-0 truncate ${kind.text}`}>{item.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
