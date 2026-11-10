import { motion } from 'motion/react';
import { formatInt, formatRate } from '../lib/format';
import { CONSUMER_GROUPS, type MetricsSnapshot } from '../lib/types';
import { Panel, Pill } from './ui';

const TOPIC_OF: Record<string, string> = {
  'payment-service': 'booking.requested · refund-requested',
  'booking-saga': 'payment.completed',
  'seat-sync': 'booking.confirmed · cancelled',
  'ticket-service': 'booking.confirmed',
  'notification-service': 'booking.cancelled · ticket.issued',
  analytics: 'booking.confirmed · cancelled',
};

export function KafkaPanel({ metrics }: { metrics: MetricsSnapshot | undefined }) {
  const lags = CONSUMER_GROUPS.map((g) => metrics?.lag[g] ?? 0);
  const scale = Math.max(20, ...lags, metrics?.outboxBacklog ?? 0);
  const totalLag = lags.reduce((a, b) => a + b, 0);

  return (
    <Panel
      title="Kafka consumers"
      subtitle="Lag grows when a consumer falls behind, then drains"
      right={<Pill tone={totalLag > 50 ? 'warn' : 'good'}>lag {formatInt(totalLag)}</Pill>}
    >
      <div className="space-y-3">
        <Row
          name="booking.outbox"
          detail="rows waiting for the relay"
          value={metrics?.outboxBacklog ?? 0}
          rate={metrics?.outboxPublished ?? 0}
          scale={scale}
          color="bg-pg"
        />
        {CONSUMER_GROUPS.map((group, i) => (
          <Row
            key={group}
            name={group}
            detail={TOPIC_OF[group] ?? ''}
            value={lags[i] ?? 0}
            rate={metrics?.consumed[group] ?? 0}
            scale={scale}
            color="bg-kafka"
          />
        ))}
      </div>
    </Panel>
  );
}

function Row({
  name,
  detail,
  value,
  rate,
  scale,
  color,
}: {
  name: string;
  detail: string;
  value: number;
  rate: number;
  scale: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate" title={detail}>
          <span className="font-mono font-semibold text-ink">{name}</span>
        </span>
        <span className="shrink-0 text-muted tabular">
          <span className="font-semibold text-ink">{formatInt(value)}</span> · {formatRate(rate)}/s
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-2">
        <motion.div
          className={`h-full rounded-full ${color}`}
          animate={{ width: `${Math.min(100, (value / scale) * 100)}%` }}
          transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        />
      </div>
    </div>
  );
}
