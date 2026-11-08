import { formatMs, formatRate } from '../lib/format';
import type { MetricsSnapshot, Mode } from '../lib/types';
import { niceMax, smoothArea, smoothLine, stack, type Point } from './charts';
import { Panel, Ticker } from './ui';
import { useNow } from './useNow';

const W = 640;
const H = 220;
const PAD = { left: 38, right: 8, top: 10, bottom: 22 };
const WINDOW_MS = 90_000;

const SERIES = [
  { key: 'ok', label: '2xx accepted', color: 'var(--color-http)' },
  { key: 'clientError', label: '403/404 not yet', color: '#8b5cf6' },
  { key: 'conflict', label: '409 seat taken', color: 'var(--color-warn)' },
  { key: 'rateLimited', label: '429 rate limited', color: '#ec4899' },
  { key: 'serverError', label: '5xx unavailable', color: 'var(--color-bad)' },
] as const;

/** Maps time and value into chart coordinates, scrolling with `now`. */
function scales(now: number, max: number, height = H) {
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  return {
    x: (at: number) => PAD.left + plotW * (1 - (now - at) / WINDOW_MS),
    y: (value: number) => PAD.top + plotH * (1 - value / max),
    plotW,
    plotH,
  };
}

export function TrafficChart({ history, mode }: { history: MetricsSnapshot[]; mode: Mode }) {
  const now = useNow();
  const visible = history.filter((m) => m.at >= now - WINDOW_MS - 5000);
  const latest = history.at(-1);
  const peak = Math.max(0, ...visible.map((m) => m.http.total));
  const max = niceMax(peak * 1.15, 10);
  const s = scales(now, max);

  const tops = stack(visible.map((m) => SERIES.map(({ key }) => m.http[key])));
  const line = (k: number): Point[] =>
    visible.map((m, i) => ({ x: s.x(m.at), y: s.y(k < 0 ? 0 : (tops[i]?.[k] ?? 0)) }));

  return (
    <Panel
      title="Requests per second"
      subtitle={
        mode === 'live'
          ? 'From Prometheus: rate(ticketsurge_http_requests_total[20s]) by status'
          : 'Every API response, grouped by status code'
      }
      right={
        <div className="text-right">
          <div className="text-2xl font-semibold text-ink">
            <Ticker value={latest?.http.total ?? 0} format={formatRate} />
            <span className="ml-1 text-xs font-normal text-muted">req/s</span>
          </div>
          <div className="text-[11px] text-faint">peak {formatRate(peak)}</div>
        </div>
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Requests per second chart"
      >
        <defs>
          <clipPath id="traffic-plot">
            <rect x={PAD.left} y={0} width={s.plotW} height={H} />
          </clipPath>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={s.y(max * f)}
              y2={s.y(max * f)}
              stroke="var(--color-line)"
              strokeWidth="0.6"
            />
            <text
              x={PAD.left - 6}
              y={s.y(max * f) + 3}
              textAnchor="end"
              fontSize="9.5"
              className="fill-faint font-mono"
            >
              {formatRate(max * f)}
            </text>
          </g>
        ))}
        {[-90, -60, -30, 0].map((sec) => (
          <text
            key={sec}
            x={s.x(now + sec * 1000)}
            y={H - 6}
            textAnchor={sec === 0 ? 'end' : 'middle'}
            fontSize="9.5"
            className="fill-faint font-mono"
          >
            {sec === 0 ? 'now' : `${sec}s`}
          </text>
        ))}
        <g clipPath="url(#traffic-plot)">
          {SERIES.map((series, k) => (
            <path
              key={series.key}
              d={smoothArea(line(k), line(k - 1))}
              fill={series.color}
              fillOpacity={series.key === 'ok' ? 0.28 : 0.55}
            />
          ))}
          <path
            d={smoothLine(line(SERIES.length - 1))}
            fill="none"
            stroke="var(--color-http)"
            strokeWidth="1.6"
          />
        </g>
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {SERIES.map((series) => (
          <span key={series.key} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="size-2 rounded-sm" style={{ background: series.color }} />
            {series.label}
            <span className="tabular text-faint">{formatRate(latest?.http[series.key] ?? 0)}</span>
          </span>
        ))}
      </div>
    </Panel>
  );
}

const ROUTES = [
  { route: 'POST /events/:id/queue', label: 'join queue', color: 'var(--color-redis)' },
  { route: 'POST /events/:id/holds', label: 'hold seats', color: 'var(--color-warn)' },
  { route: 'POST /bookings', label: 'create booking', color: 'var(--color-pg)' },
];

const LH = 150;

export function LatencyChart({ history }: { history: MetricsSnapshot[] }) {
  const now = useNow();
  const visible = history.filter((m) => m.at >= now - WINDOW_MS - 5000);
  const latest = history.at(-1);
  const peak = Math.max(0, ...visible.flatMap((m) => ROUTES.map((r) => m.p95Ms[r.route] ?? 0)));
  const max = niceMax(peak * 1.2, 10);
  const s = scales(now, max, LH);

  return (
    <Panel title="p95 latency (ms)" subtitle="The hot paths stay fast under load">
      <svg
        viewBox={`0 0 ${W} ${LH}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Latency chart"
      >
        <defs>
          <clipPath id="latency-plot">
            <rect x={PAD.left} y={0} width={s.plotW} height={LH} />
          </clipPath>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={s.y(max * f)}
              y2={s.y(max * f)}
              stroke="var(--color-line)"
              strokeWidth="0.6"
            />
            <text
              x={PAD.left - 6}
              y={s.y(max * f) + 3}
              textAnchor="end"
              fontSize="9.5"
              className="fill-faint font-mono"
            >
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        <g clipPath="url(#latency-plot)">
          {ROUTES.map((r) => {
            const points = visible
              .filter((m) => m.p95Ms[r.route] !== undefined)
              .map((m) => ({ x: s.x(m.at), y: s.y(m.p95Ms[r.route] ?? 0) }));
            return (
              <path
                key={r.route}
                d={smoothLine(points)}
                fill="none"
                stroke={r.color}
                strokeWidth="1.8"
              />
            );
          })}
        </g>
      </svg>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {ROUTES.map((r) => (
          <div key={r.route} className="rounded-lg border border-line bg-panel-2/60 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="size-2 rounded-full" style={{ background: r.color }} />
              {r.label}
            </div>
            <div className="mt-0.5 font-mono text-sm text-ink tabular">
              {formatMs(latest?.p95Ms[r.route])}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
