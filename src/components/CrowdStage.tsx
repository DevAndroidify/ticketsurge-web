import { useEffect, useRef } from 'react';
import type { BotPhase } from '../lib/bots/swarm';
import type { JourneyStep } from '../lib/buyer/journey';
import { formatInt } from '../lib/format';
import { Panel, Pill } from './ui';

interface Zone {
  label: string;
  /** Position and size as fractions of the stage. */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  phases: readonly BotPhase[];
  /** Where the visitor's own dot goes while at these steps. */
  steps: readonly JourneyStep[];
}

const ZONES: Zone[] = [
  {
    label: 'Arriving',
    x: 0,
    y: 0,
    w: 0.14,
    h: 1,
    color: '--color-muted',
    phases: ['registering'],
    steps: ['signing-in'],
  },
  {
    label: 'Waiting room',
    x: 0.15,
    y: 0,
    w: 0.23,
    h: 1,
    color: '--color-redis',
    phases: ['queued'],
    steps: ['queued'],
  },
  {
    label: 'Picking seats',
    x: 0.39,
    y: 0,
    w: 0.13,
    h: 1,
    color: '--color-warn',
    phases: ['holding'],
    steps: ['picking', 'holding', 'held'],
  },
  {
    label: 'Booking',
    x: 0.53,
    y: 0,
    w: 0.09,
    h: 1,
    color: '--color-pg',
    phases: ['booking'],
    steps: ['booking'],
  },
  {
    label: 'Paying',
    x: 0.63,
    y: 0,
    w: 0.11,
    h: 1,
    color: '--color-kafka',
    phases: ['paying'],
    steps: ['paying'],
  },
  {
    label: 'Got tickets',
    x: 0.75,
    y: 0,
    w: 0.25,
    h: 0.52,
    color: '--color-ok',
    phases: ['confirmed'],
    steps: ['confirmed'],
  },
  {
    label: 'Payment failed',
    x: 0.75,
    y: 0.54,
    w: 0.25,
    h: 0.2,
    color: '--color-bad',
    phases: ['cancelled', 'expired', 'failed'],
    steps: ['cancelled', 'expired', 'error'],
  },
  {
    label: 'Missed out',
    x: 0.75,
    y: 0.76,
    w: 0.25,
    h: 0.24,
    color: '--color-faint',
    phases: ['lost', 'abandoned'],
    steps: ['hold-lost', 'released'],
  },
];

const ZONE_OF = new Map<BotPhase, number>(
  ZONES.flatMap((zone, index) => zone.phases.map((phase) => [phase, index] as const)),
);

const MIN_HEIGHT = 280;
const HEADER = 30;
const PAD = 8;
const MAX_CELL = 11;
const MIN_CELL = 3.2;

interface Dot {
  x: number;
  y: number;
  /** Each buyer moves at a slightly different speed, so a wave spreads out. */
  speed: number;
  zone: number | undefined;
  /** Set when the buyer changes zone; cleared with a burst when they land. */
  arriving: boolean;
}

/** A ring (and for a sale, a few sparks) where a buyer just landed. */
interface Burst {
  x: number;
  y: number;
  born: number;
  color: string;
  sparks: boolean;
}

const CONFIRMED_ZONE = 5;
const MISSED_ZONE = 7;
const BURST_MS = 700;
const MAX_BURSTS = 140;

interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

function zoneRect(zone: Zone, width: number, height: number): Slot {
  return { x: zone.x * width, y: zone.y * height, w: zone.w * width, h: zone.h * height };
}

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Every dot is one buyer. Dots enter from the left and move between zones as their phase changes.
 * Drawn on a canvas, because a crowd of 2,000 is too many elements to animate in the DOM.
 */
export function CrowdStage({
  bots,
  startedAt,
  step,
  rps,
}: {
  bots: readonly BotPhase[];
  startedAt: number | undefined;
  step: JourneyStep | undefined;
  rps: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ bots, startedAt, step });
  useEffect(() => {
    live.current = { bots, startedAt, step };
  }, [bots, startedAt, step]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const colors = ZONES.map((zone) => cssColor(zone.color));
    const you = cssColor('--color-you');
    const http = cssColor('--color-http');
    const line = cssColor('--color-line');
    const muted = cssColor('--color-muted');
    const ink = cssColor('--color-ink');
    const sans = cssColor('--font-sans');
    const display = cssColor('--font-display');

    let width = 0;
    let height = MIN_HEIGHT;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const dots: Dot[] = [];
    const bursts: Burst[] = [];
    let run: number | undefined;
    let surge = 0;
    let youDot: { x: number; y: number } | undefined;
    let last = performance.now();
    let frame = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { bots: phases, startedAt: started, step: yourStep } = live.current;

      if (run !== started) {
        run = started;
        dots.length = 0;
        bursts.length = 0;
      }
      if (phases.length > dots.length) {
        surge = Math.min(1, surge + (phases.length - dots.length) / 150);
      }
      while (dots.length < phases.length) {
        dots.push({
          x: reduced ? 0 : -12 - Math.random() * 80,
          y: HEADER + Math.random() * (height - HEADER),
          speed: 3 + Math.random() * 3.5,
          zone: undefined,
          arriving: false,
        });
      }

      const counts = new Array<number>(ZONES.length).fill(0);
      for (const phase of phases) {
        const zone = ZONE_OF.get(phase);
        if (zone !== undefined) counts[zone] = (counts[zone] ?? 0) + 1;
      }
      const grids = ZONES.map((zone, i) => {
        const rect = zoneRect(zone, width, height);
        const areaW = Math.max(1, rect.w - PAD * 2);
        const areaH = Math.max(1, rect.h - HEADER - PAD);
        const count = Math.max(1, counts[i] ?? 0);
        const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.sqrt((areaW * areaH) / count)));
        const cols = Math.max(1, Math.floor(areaW / cell));
        const radius = Math.max(1.1, Math.min(cell * 0.36, 3.4));
        return { rect, cell, cols, radius, used: 0 };
      });

      ctx.clearRect(0, 0, width, height);
      ctx.textBaseline = 'middle';
      ZONES.forEach((zone, i) => {
        const { rect } = grids[i] ?? { rect: zoneRect(zone, width, height) };
        const color = colors[i] ?? muted;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 12);
        ctx.clip();
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = color;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        // A colored band along the top names the zone at a glance.
        ctx.globalAlpha = 1;
        ctx.fillRect(rect.x, rect.y, rect.w, 3);
        ctx.restore();
        ctx.strokeStyle = line;
        ctx.beginPath();
        ctx.roundRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, 12);
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.fillStyle = muted;
        ctx.font = `600 11.5px ${sans}`;
        ctx.fillText(zone.label, rect.x + 10, rect.y + 17, rect.w - 44);
        ctx.textAlign = 'right';
        ctx.fillStyle = ink;
        ctx.font = `700 14px ${display}`;
        ctx.fillText(formatInt(counts[i] ?? 0), rect.x + rect.w - 10, rect.y + 17);
      });
      ctx.font = `700 10.5px ${sans}`;

      // A burst of arrivals lights up the entrance.
      if (surge > 0.01) {
        const glow = ctx.createLinearGradient(0, 0, 90, 0);
        glow.addColorStop(0, http);
        glow.addColorStop(1, 'transparent');
        ctx.globalAlpha = surge * 0.3;
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, 90, height);
        ctx.globalAlpha = 1;
        surge *= Math.exp(-dt * 2.2);
      }

      const easing = (speed: number) => (reduced ? 1 : 1 - Math.exp(-dt * speed));
      const byZone = ZONES.map(() => new Path2D());
      phases.forEach((phase, index) => {
        const dot = dots[index];
        const zone = ZONE_OF.get(phase);
        const grid = zone === undefined ? undefined : grids[zone];
        const path = zone === undefined ? undefined : byZone[zone];
        if (!dot || !grid || !path) return;

        const slot = grid.used++;
        const col = slot % grid.cols;
        const row = Math.floor(slot / grid.cols);
        const targetX = grid.rect.x + PAD + (col + 0.5) * grid.cell;
        const targetY = Math.min(
          grid.rect.y + HEADER + (row + 0.5) * grid.cell,
          grid.rect.y + grid.rect.h - PAD,
        );
        // Waiting people shuffle a little; everyone else moves with purpose.
        const sway = phase === 'queued' && !reduced ? Math.sin(now / 420 + index * 1.7) * 0.8 : 0;
        if (dot.zone !== zone) {
          dot.arriving = dot.zone !== undefined;
          dot.zone = zone;
        }
        const ease = easing(dot.speed);
        dot.x += (targetX + sway - dot.x) * ease;
        dot.y += (targetY - dot.y) * ease;
        if (dot.arriving && Math.abs(targetX - dot.x) + Math.abs(targetY - dot.y) < 3) {
          dot.arriving = false;
          if ((zone === CONFIRMED_ZONE || zone === MISSED_ZONE) && bursts.length < MAX_BURSTS) {
            bursts.push({
              x: targetX,
              y: targetY,
              born: now,
              color: colors[zone] ?? muted,
              sparks: zone === CONFIRMED_ZONE,
            });
          }
        }
        path.moveTo(dot.x + grid.radius, dot.y);
        path.arc(dot.x, dot.y, grid.radius, 0, Math.PI * 2);
      });
      byZone.forEach((path, i) => {
        ctx.fillStyle = colors[i] ?? muted;
        ctx.fill(path);
      });

      // A buyer who gets tickets sets off a ring and sparks; one who misses out, a faint ring.
      for (let i = bursts.length - 1; i >= 0; i--) {
        const burst = bursts[i];
        if (!burst) continue;
        const t = (now - burst.born) / BURST_MS;
        if (t >= 1 || reduced) {
          bursts.splice(i, 1);
          continue;
        }
        const out = 1 - (1 - t) ** 3;
        ctx.strokeStyle = burst.color;
        ctx.globalAlpha = (1 - t) * (burst.sparks ? 0.9 : 0.45);
        ctx.lineWidth = burst.sparks ? 2 : 1.4;
        ctx.beginPath();
        ctx.arc(burst.x, burst.y, 3 + out * (burst.sparks ? 15 : 9), 0, Math.PI * 2);
        ctx.stroke();
        if (burst.sparks) {
          for (let k = 0; k < 6; k++) {
            const angle = (k / 6) * Math.PI * 2 + burst.born;
            const inner = 6 + out * 12;
            const outer = inner + 4 * (1 - t);
            ctx.beginPath();
            ctx.moveTo(burst.x + Math.cos(angle) * inner, burst.y + Math.sin(angle) * inner);
            ctx.lineTo(burst.x + Math.cos(angle) * outer, burst.y + Math.sin(angle) * outer);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;

      const yourZone = yourStep ? ZONES.findIndex((z) => z.steps.includes(yourStep)) : -1;
      const yourRect = grids[yourZone]?.rect;
      if (!yourRect) {
        youDot = undefined;
      } else {
        const targetX = yourRect.x + yourRect.w / 2;
        const targetY = yourRect.y + (yourRect.h + HEADER) / 2;
        youDot ??= { x: -14, y: targetY };
        const ease = easing(5);
        youDot.x += (targetX - youDot.x) * ease;
        youDot.y += (targetY - youDot.y) * ease;
        const pulse = reduced ? 0.5 : (Math.sin(now / 260) + 1) / 2;
        ctx.globalAlpha = 0.35 * (1 - pulse) + 0.1;
        ctx.fillStyle = you;
        ctx.beginPath();
        ctx.arc(youDot.x, youDot.y, 11 + pulse * 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(youDot.x, youDot.y, 6.5, 0, Math.PI * 2);
        ctx.fill();
        // A solid label, because the dot often sits in the middle of a dense crowd.
        ctx.beginPath();
        ctx.roundRect(youDot.x - 17, youDot.y - 31, 34, 17, 8.5);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText('YOU', youDot.x, youDot.y - 22.5);
      }

      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const confirmed = bots.filter((p) => p === 'confirmed').length;
  return (
    <Panel
      title="The crowd"
      className="flex flex-col"
      subtitle="Every dot is one buyer moving through the sale. Add traffic and watch the wave arrive."
      right={
        <div className="flex flex-wrap gap-1.5">
          <Pill tone="info">{formatInt(bots.length)} buyers</Pill>
          <Pill tone="good">{formatInt(confirmed)} got tickets</Pill>
          <Pill>{Math.round(rps)} req/s</Pill>
        </div>
      }
    >
      {/* The canvas is absolute so its own size cannot feed back into the panel's height. */}
      <div className="relative -mx-1 flex-1 overflow-x-auto" style={{ minHeight: MIN_HEIGHT }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block size-full min-w-[640px]"
          role="img"
          aria-label={`${bots.length} buyers in the sale, ${confirmed} have tickets`}
        />
      </div>
    </Panel>
  );
}
