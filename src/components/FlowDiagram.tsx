import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import type { JourneyEntry, TraceId } from '../lib/buyer/journey';
import { formatInt, formatRate, sum } from '../lib/format';
import { visualRate } from './charts';
import type { ComponentState, ComponentStatus, MetricsSnapshot } from '../lib/types';
import { Panel } from './ui';

type Tech = 'http' | 'redis' | 'kafka' | 'pg' | 'ws';

const COLORS: Record<Tech, string> = {
  http: 'var(--color-http)',
  redis: 'var(--color-redis)',
  kafka: 'var(--color-kafka)',
  pg: 'var(--color-pg)',
  ws: 'var(--color-ws)',
};

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  tech?: Tech;
  /** The component whose health colors this node. */
  status?: string;
  stat?: (m: MetricsSnapshot, clientRps: number) => string;
}

interface Edge {
  id: string;
  from: string;
  to: string;
  tech: Tech;
  label?: string;
  /** Bend, so two edges between the same nodes do not overlap. */
  bend?: number;
  rate: (m: MetricsSnapshot, clientRps: number) => number;
}

const consumed = (m: MetricsSnapshot, group: string) => m.consumed[group] ?? 0;
const lag = (m: MetricsSnapshot, group: string) => m.lag[group] ?? 0;

const NODES: Node[] = [
  {
    id: 'browser',
    label: 'Buyers',
    x: 70,
    y: 235,
    tech: 'http',
    stat: (m, c) => `${formatRate(Math.max(c, m.http.total))} req/s`,
  },
  {
    id: 'api',
    label: 'API',
    x: 255,
    y: 150,
    status: 'api',
    stat: (m) => `${formatRate(m.http.total)} req/s`,
  },
  {
    id: 'gateway',
    label: 'Realtime gateway',
    x: 255,
    y: 340,
    status: 'realtime-gateway',
    stat: (m) => `${formatInt(m.wsConnections)} sockets`,
  },
  {
    id: 'admission',
    label: 'Admission worker',
    x: 470,
    y: 40,
    status: 'admission-worker',
    stat: (m) => `${formatInt(m.queueWaiting)} waiting`,
  },
  {
    id: 'redis',
    label: 'Redis',
    x: 470,
    y: 150,
    tech: 'redis',
    status: 'redis',
    stat: () => 'queue · holds · pub/sub',
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    x: 470,
    y: 340,
    tech: 'pg',
    status: 'postgres',
    stat: (m) => `outbox ${formatInt(m.outboxBacklog)}`,
  },
  {
    id: 'worker',
    label: 'Booking worker',
    x: 690,
    y: 340,
    status: 'booking-worker',
    stat: (m) => `saga ${formatRate(consumed(m, 'booking-saga'))}/s`,
  },
  {
    id: 'kafka',
    label: 'Kafka',
    x: 690,
    y: 150,
    tech: 'kafka',
    status: 'kafka',
    stat: (m) => `lag ${formatInt(sum(Object.values(m.lag)))}`,
  },
  {
    id: 'payment',
    label: 'Payment',
    x: 905,
    y: 45,
    status: 'payment-service',
    stat: (m) => `lag ${formatInt(lag(m, 'payment-service'))}`,
  },
  {
    id: 'ticket',
    label: 'Tickets',
    x: 905,
    y: 160,
    status: 'ticket-service',
    stat: (m) => `lag ${formatInt(lag(m, 'ticket-service'))}`,
  },
  {
    id: 'notify',
    label: 'Notifications',
    x: 905,
    y: 275,
    status: 'notification-service',
    stat: (m) => `lag ${formatInt(lag(m, 'notification-service'))}`,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    x: 905,
    y: 390,
    status: 'analytics-service',
    stat: (m) => `lag ${formatInt(lag(m, 'analytics'))}`,
  },
];

const EDGES: Edge[] = [
  {
    id: 'b-api',
    from: 'browser',
    to: 'api',
    tech: 'http',
    label: 'HTTP',
    rate: (m, c) => Math.max(c, m.http.total),
  },
  {
    id: 'api-redis',
    from: 'api',
    to: 'redis',
    tech: 'redis',
    label: 'Lua',
    rate: (m) => m.http.total * 0.75,
  },
  {
    id: 'api-pg',
    from: 'api',
    to: 'postgres',
    tech: 'pg',
    label: 'tx',
    rate: (m) => m.http.total * 0.25,
  },
  { id: 'adm-redis', from: 'admission', to: 'redis', tech: 'redis', rate: (m) => m.admitted },
  {
    id: 'pg-worker',
    from: 'postgres',
    to: 'worker',
    tech: 'pg',
    label: 'outbox',
    rate: (m) => m.outboxPublished,
  },
  {
    id: 'worker-kafka',
    from: 'worker',
    to: 'kafka',
    tech: 'kafka',
    bend: 30,
    rate: (m) => m.outboxPublished,
  },
  {
    id: 'kafka-worker',
    from: 'kafka',
    to: 'worker',
    tech: 'kafka',
    bend: 30,
    rate: (m) => consumed(m, 'booking-saga') + consumed(m, 'seat-sync'),
  },
  {
    id: 'worker-redis',
    from: 'worker',
    to: 'redis',
    tech: 'redis',
    label: 'seat sync',
    rate: (m) => consumed(m, 'seat-sync'),
  },
  {
    id: 'kafka-pay',
    from: 'kafka',
    to: 'payment',
    tech: 'kafka',
    bend: 22,
    rate: (m) => consumed(m, 'payment-service'),
  },
  {
    id: 'pay-kafka',
    from: 'payment',
    to: 'kafka',
    tech: 'kafka',
    bend: 22,
    rate: (m) => consumed(m, 'payment-service'),
  },
  {
    id: 'kafka-ticket',
    from: 'kafka',
    to: 'ticket',
    tech: 'kafka',
    rate: (m) => consumed(m, 'ticket-service'),
  },
  {
    id: 'kafka-notify',
    from: 'kafka',
    to: 'notify',
    tech: 'kafka',
    rate: (m) => consumed(m, 'notification-service'),
  },
  {
    id: 'kafka-analytics',
    from: 'kafka',
    to: 'analytics',
    tech: 'kafka',
    rate: (m) => consumed(m, 'analytics'),
  },
  {
    id: 'redis-gw',
    from: 'redis',
    to: 'gateway',
    tech: 'ws',
    label: 'pub/sub',
    rate: (m) => m.wsForwarded,
  },
  {
    id: 'gw-browser',
    from: 'gateway',
    to: 'browser',
    tech: 'ws',
    label: 'WebSocket',
    rate: (m) => m.wsForwarded,
  },
];

/**
 * The route each of the visitor's actions takes. Each inner list is one moment; a leading ~ means
 * the edge is travelled backwards, as a response. Requests are drawn when they happen, and the
 * asynchronous part follows the architecture's order once the outcome is known.
 */
const REQUEST_REPLY = [['b-api'], ['api-redis'], ['~api-redis'], ['~b-api']];
const SEAT_BROADCAST = [['b-api'], ['api-redis'], ['redis-gw'], ['gw-browser']];
const TRACES: Record<TraceId, string[][]> = {
  signup: [['b-api'], ['api-pg'], ['~api-pg'], ['~b-api']],
  queue: REQUEST_REPLY,
  admitted: [['adm-redis'], ['~api-redis'], ['~b-api']],
  hold: SEAT_BROADCAST,
  'hold-rejected': REQUEST_REPLY,
  release: SEAT_BROADCAST,
  book: [['b-api'], ['api-pg'], ['pg-worker'], ['worker-kafka'], ['kafka-pay']],
  confirmed: [
    ['pay-kafka'],
    ['kafka-worker'],
    ['worker-kafka'],
    ['kafka-ticket', 'kafka-analytics', 'kafka-worker'],
    ['kafka-notify', 'worker-redis'],
    ['redis-gw'],
    ['gw-browser'],
  ],
  cancelled: [
    ['pay-kafka'],
    ['kafka-worker'],
    ['worker-kafka'],
    ['kafka-notify', 'kafka-analytics', 'kafka-worker'],
    ['worker-redis'],
    ['redis-gw'],
    ['gw-browser'],
  ],
  expired: [
    ['pg-worker'],
    ['worker-kafka'],
    ['kafka-notify', 'kafka-analytics', 'kafka-worker'],
    ['worker-redis'],
    ['redis-gw'],
    ['gw-browser'],
  ],
};

const NODE_W = 132;
const NODE_H = 50;
const TRAVEL_MS = 1100;
const MAX_PARTICLES = 450;
const HOP_MS = 430;
const COMET_TAIL = 5;
/** A trace not yet started is dropped once this many are waiting, so the picture keeps up. */
const MAX_WAITING_TRACES = 2;
const SVG_NS = 'http://www.w3.org/2000/svg';

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

interface Comet {
  path: SVGPathElement;
  length: number;
  reverse: boolean;
  destination: Node;
  dots: SVGCircleElement[];
  /** The edge's stroke before it was lit up. */
  stroke: { color: string | null; opacity: string | null };
}

interface ActiveTrace {
  steps: string[][];
  index: number;
  t: number;
  color: string;
  comets: Comet[];
}

function launchComets(
  hops: string[],
  color: string,
  paths: Map<string, SVGPathElement>,
  layer: SVGGElement,
): Comet[] {
  return hops.flatMap((hop) => {
    const reverse = hop.startsWith('~');
    const id = reverse ? hop.slice(1) : hop;
    const edge = EDGES.find((e) => e.id === id);
    const path = paths.get(id);
    if (!edge || !path) return [];
    const stroke = {
      color: path.getAttribute('stroke'),
      opacity: path.getAttribute('stroke-opacity'),
    };
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-opacity', '0.95');
    const dots = Array.from({ length: COMET_TAIL }, (_, i) => {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('r', String(6.5 - i * 1.1));
      dot.setAttribute('fill', i === 0 ? '#fff' : color);
      dot.setAttribute('opacity', String(1 - i * 0.17));
      if (i === 0) dot.style.filter = `drop-shadow(0 0 7px ${color})`;
      layer.appendChild(dot);
      return dot;
    });
    return [
      {
        path,
        length: path.getTotalLength(),
        reverse,
        destination: nodeById(reverse ? edge.from : edge.to),
        dots,
        stroke,
      },
    ];
  });
}

function retireComet(comet: Comet) {
  for (const dot of comet.dots) dot.remove();
  if (comet.stroke.color) comet.path.setAttribute('stroke', comet.stroke.color);
  if (comet.stroke.opacity) comet.path.setAttribute('stroke-opacity', comet.stroke.opacity);
}

/** A ring that expands from a node as the comet arrives. CSS removes it from view. */
function flashNode(layer: SVGGElement, node: Node, color: string) {
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', String(node.x - NODE_W / 2));
  rect.setAttribute('y', String(node.y - NODE_H / 2));
  rect.setAttribute('width', String(NODE_W));
  rect.setAttribute('height', String(NODE_H));
  rect.setAttribute('rx', '11');
  rect.setAttribute('fill', color);
  rect.setAttribute('fill-opacity', '0.18');
  rect.setAttribute('stroke', color);
  rect.setAttribute('stroke-width', '2');
  rect.setAttribute('class', 'node-flash');
  rect.addEventListener('animationend', () => {
    rect.remove();
  });
  layer.appendChild(rect);
}

function nodeById(id: string): Node {
  const node = NODES.find((n) => n.id === id);
  if (!node) throw new Error(`unknown node ${id}`);
  return node;
}

/** Quadratic curve between two node centers, bent sideways by `bend`. */
function edgePath(edge: Edge): string {
  const a = nodeById(edge.from);
  const b = nodeById(edge.to);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const bend = edge.bend ?? 0;
  const cx = mx + (-dy / length) * bend;
  const cy = my + (dx / length) * bend;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

interface Particle {
  el: SVGCircleElement;
  path: SVGPathElement;
  length: number;
  born: number;
}

export function FlowDiagram({
  metrics,
  clientRps,
  components,
  journey,
}: {
  metrics: MetricsSnapshot | undefined;
  clientRps: number;
  components: ComponentStatus[];
  /** The visitor's purchase, newest first. Entries with a trace are drawn as a comet. */
  journey: readonly JourneyEntry[];
}) {
  const layer = useRef<SVGGElement>(null);
  const cometLayer = useRef<SVGGElement>(null);
  const flashLayer = useRef<SVGGElement>(null);
  const paths = useRef(new Map<string, SVGPathElement>());
  const live = useRef({ metrics, clientRps });
  useEffect(() => {
    live.current = { metrics, clientRps };
  }, [metrics, clientRps]);

  const waitingTraces = useRef<JourneyEntry[]>([]);
  const lastTraced = useRef(0);
  useEffect(() => {
    const fresh = journey.filter((e) => e.id > lastTraced.current && e.trace).reverse();
    lastTraced.current = Math.max(lastTraced.current, journey[0]?.id ?? 0);
    waitingTraces.current.push(...fresh);
  }, [journey]);
  const latest = journey[0];

  const state = new Map(components.map((c) => [c.id, c.state]));
  const stateOf = (node: Node): ComponentState =>
    node.status ? (state.get(node.status) ?? 'unknown') : 'up';

  // One animation loop for every particle; the DOM is updated directly, outside React.
  useEffect(() => {
    const group = layer.current;
    const comets = cometLayer.current;
    const flashes = flashLayer.current;
    if (!group || !comets || !flashes) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const particles: Particle[] = [];
    const credit = new Map<string, number>();
    let trace: ActiveTrace | undefined;
    let last = performance.now();
    let frame = 0;

    const startStep = (active: ActiveTrace) => {
      active.t = 0;
      active.comets = launchComets(
        active.steps[active.index] ?? [],
        active.color,
        paths.current,
        comets,
      );
    };

    /** Moves the visitor's comet along; only one trace plays at a time. */
    const advanceTrace = (dt: number) => {
      const waiting = waitingTraces.current;
      if (reduced) waiting.length = 0;
      if (!trace) {
        while (waiting.length > MAX_WAITING_TRACES) waiting.shift();
        const next = waiting.shift();
        if (!next?.trace) return;
        trace = {
          steps: TRACES[next.trace],
          index: 0,
          t: 0,
          color: next.tone === 'bad' ? 'var(--color-bad)' : 'var(--color-you)',
          comets: [],
        };
        startStep(trace);
      }
      trace.t += (dt * 1000) / HOP_MS;
      const progress = Math.min(1, trace.t);
      for (const comet of trace.comets) {
        comet.dots.forEach((dot, i) => {
          const travelled = ease(Math.max(0, progress - i * 0.045));
          const along = comet.reverse ? 1 - travelled : travelled;
          const point = comet.path.getPointAtLength(along * comet.length);
          dot.setAttribute('cx', point.x.toFixed(1));
          dot.setAttribute('cy', point.y.toFixed(1));
        });
      }
      if (trace.t < 1) return;
      for (const comet of trace.comets) {
        retireComet(comet);
        flashNode(flashes, comet.destination, trace.color);
      }
      trace.index++;
      if (trace.index >= trace.steps.length) trace = undefined;
      else startStep(trace);
    };

    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { metrics: m, clientRps: c } = live.current;
      advanceTrace(dt);

      if (m && !reduced) {
        for (const edge of EDGES) {
          const path = paths.current.get(edge.id);
          if (!path) continue;
          const next = (credit.get(edge.id) ?? 0) + visualRate(edge.rate(m, c)) * dt;
          let whole = Math.floor(next);
          credit.set(edge.id, next - whole);
          while (whole-- > 0 && particles.length < MAX_PARTICLES) {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            el.setAttribute('r', edge.tech === 'http' ? '3' : '2.6');
            el.setAttribute('fill', COLORS[edge.tech]);
            el.style.filter = `drop-shadow(0 0 4px ${COLORS[edge.tech]})`;
            group.appendChild(el);
            // Stagger births inside the frame so bursts spread out along the edge.
            particles.push({
              el,
              path,
              length: path.getTotalLength(),
              born: now - Math.random() * 120,
            });
          }
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (!p) continue;
        const t = (now - p.born) / TRAVEL_MS;
        if (t >= 1) {
          p.el.remove();
          particles.splice(i, 1);
          continue;
        }
        // Ease in and out so particles leave and arrive gently.
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const point = p.path.getPointAtLength(eased * p.length);
        p.el.setAttribute('cx', point.x.toFixed(1));
        p.el.setAttribute('cy', point.y.toFixed(1));
        p.el.setAttribute('opacity', String(t < 0.1 ? t * 10 : t > 0.9 ? (1 - t) * 10 : 1));
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      for (const p of particles) p.el.remove();
      for (const comet of trace?.comets ?? []) retireComet(comet);
    };
  }, []);

  return (
    <Panel
      title="How a booking moves through the system"
      subtitle="Small dots are traffic, at the rate the metrics report. The bright comet is your own purchase."
      right={<Legend />}
    >
      <div className="-mx-1 overflow-x-auto">
        <svg
          viewBox="0 0 980 440"
          className="block w-full min-w-[640px]"
          role="img"
          aria-label="Architecture flow"
        >
          <defs>
            <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path
                d="M 28 0 L 0 0 0 28"
                fill="none"
                stroke="var(--color-line)"
                strokeWidth="0.5"
                opacity="0.5"
              />
            </pattern>
          </defs>
          <rect x="0" y="0" width="980" height="440" fill="url(#grid)" opacity="0.6" />

          {EDGES.map((edge) => {
            const down = [nodeById(edge.from), nodeById(edge.to)].some(
              (n) => stateOf(n) === 'down',
            );
            const d = edgePath(edge);
            const a = nodeById(edge.from);
            const b = nodeById(edge.to);
            return (
              <g key={edge.id}>
                <path
                  ref={(el) => {
                    if (el) paths.current.set(edge.id, el);
                  }}
                  d={d}
                  fill="none"
                  stroke={down ? 'var(--color-bad)' : COLORS[edge.tech]}
                  strokeOpacity={down ? 0.5 : 0.22}
                  strokeWidth={1.5}
                  strokeDasharray={down ? '4 5' : undefined}
                />
                {edge.label && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 6}
                    textAnchor="middle"
                    className="fill-faint font-mono"
                    fontSize="9.5"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          <g ref={layer} />
          <g ref={cometLayer} />

          {NODES.map((node) => (
            <NodeBox
              key={node.id}
              node={node}
              state={stateOf(node)}
              stat={metrics && node.stat ? node.stat(metrics, clientRps) : ''}
            />
          ))}

          <g ref={flashLayer} />
        </svg>
      </div>

      <div className="mt-2 min-h-10 rounded-lg border border-line bg-panel-2/50 px-3 py-2 text-xs">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={latest?.id ?? 'hint'}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
          >
            {latest ? (
              <>
                <span className="font-semibold text-you">{latest.title}.</span>{' '}
                <span className="text-muted">{latest.detail}</span>
              </>
            ) : (
              <span className="text-faint">
                Buy a ticket to watch your own request travel through these services.
              </span>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </Panel>
  );
}

function NodeBox({ node, state, stat }: { node: Node; state: ComponentState; stat: string }) {
  const accent = node.tech ? COLORS[node.tech] : 'var(--color-muted)';
  const border =
    state === 'down' ? 'var(--color-bad)' : state === 'starting' ? 'var(--color-warn)' : accent;
  const dot =
    state === 'up'
      ? 'var(--color-ok)'
      : state === 'down'
        ? 'var(--color-bad)'
        : state === 'starting'
          ? 'var(--color-warn)'
          : 'var(--color-faint)';
  return (
    <g
      transform={`translate(${node.x - NODE_W / 2} ${node.y - NODE_H / 2})`}
      opacity={state === 'unknown' ? 0.55 : 1}
    >
      <rect
        width={NODE_W}
        height={NODE_H}
        rx="11"
        fill="var(--color-panel-2)"
        stroke={border}
        strokeOpacity={state === 'up' ? 0.55 : 0.9}
        strokeWidth="1.2"
      />
      <circle cx="14" cy="17" r="3.5" fill={dot}>
        {state === 'starting' && (
          <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
        )}
      </circle>
      <text x="25" y="21" fontSize="12.5" fontWeight="600" fill="var(--color-ink)">
        {node.label}
      </text>
      <text
        x="14"
        y="38"
        fontSize="10"
        className="font-mono"
        fill={state === 'down' ? 'var(--color-bad)' : 'var(--color-muted)'}
      >
        {state === 'down' ? 'DOWN' : stat}
      </text>
    </g>
  );
}

function Legend() {
  const items: [Tech, string][] = [
    ['http', 'HTTP'],
    ['redis', 'Redis'],
    ['pg', 'Postgres'],
    ['kafka', 'Kafka'],
    ['ws', 'WebSocket'],
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {items.map(([tech, label]) => (
        <span key={tech} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="size-2 rounded-full" style={{ background: COLORS[tech] }} />
          {label}
        </span>
      ))}
      <span className="flex items-center gap-1.5 text-[11px] text-muted">
        <span className="size-2 rounded-full bg-you" />
        You
      </span>
    </div>
  );
}
