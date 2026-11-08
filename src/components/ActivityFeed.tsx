import type { Activity, ActivityKind } from '../lib/bots/swarm';
import { Panel } from './ui';

const KIND: Record<ActivityKind, string> = {
  info: 'text-muted',
  success: 'text-ok',
  warn: 'text-warn',
  error: 'text-bad',
};

/** Newest first. Each line slides in once (CSS, keyed by id); nothing animates on the way out. */
export function ActivityFeed({ activity }: { activity: Activity[] }) {
  const shown = activity.slice(0, 18);
  return (
    <Panel title="Live activity" subtitle="What individual buyers just experienced">
      {shown.length === 0 ? (
        <div className="grid h-40 place-items-center text-xs text-faint">Quiet. Launch a sale.</div>
      ) : (
        <ul className="max-h-[420px] space-y-1 overflow-hidden font-mono text-[11px]">
          {shown.map((item) => (
            <li key={item.id} className="feed-in flex gap-2">
              <span className="shrink-0 text-faint tabular">
                {new Date(item.at).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className="shrink-0 text-http">{item.bot}</span>
              <span className={`min-w-0 truncate ${KIND[item.kind]}`}>{item.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
