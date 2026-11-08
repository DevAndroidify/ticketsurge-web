import { Box, Cpu, Power, PowerOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { Chaos } from '../lib/backend';
import type { ComponentStatus, Mode } from '../lib/types';
import { Panel, Pill, StatusDot } from './ui';

const STOP_EFFECT: Record<string, string> = {
  redis: 'Queue and hold requests get 503; bots back off and retry.',
  'booking-worker': 'Outbox rows pile up in PostgreSQL. Nothing is lost.',
  'payment-service': 'booking.requested lag grows; slow payments expire and are refunded.',
  'ticket-service': 'Confirmed bookings wait for tickets; lag drains on restart.',
  'notification-service': 'Notifications queue up in Kafka until it comes back.',
};

export function InfraPanel({
  components,
  mode,
  chaos,
  onChaos,
}: {
  components: ComponentStatus[];
  mode: Mode;
  chaos?: Chaos;
  onChaos: () => void;
}) {
  const containers = components.filter((c) => c.kind === 'container');
  const services = components.filter((c) => c.kind === 'service');
  const healthy = components.filter((c) => c.state === 'up').length;

  return (
    <Panel
      title="Infrastructure"
      subtitle={
        mode === 'live'
          ? 'docker compose + Node services, checked every 2 s'
          : 'Simulated: npm run infra:up, then the services'
      }
      right={
        <Pill tone={healthy === components.length && healthy > 0 ? 'good' : 'warn'}>
          {healthy}/{components.length || '–'} healthy
        </Pill>
      }
    >
      <Group icon={<Box className="size-3.5" />} label="Docker containers">
        {containers.map((c, i) => (
          <Card key={c.id} component={c} index={i} chaos={chaos} onChaos={onChaos} />
        ))}
      </Group>
      <Group icon={<Cpu className="size-3.5" />} label="Node services">
        {services.map((c, i) => (
          <Card
            key={c.id}
            component={c}
            index={i + containers.length}
            chaos={chaos}
            onChaos={onChaos}
          />
        ))}
      </Group>
      {mode === 'live' && (
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Try a failure: <code className="text-muted">docker stop ticketsurge-redis-1</code>, or
          stop the payment service&apos;s terminal, and watch the panels react.
        </p>
      )}
    </Panel>
  );
}

function Group({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-faint uppercase">
        {icon}
        {label}
      </div>
      <div className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
        <AnimatePresence initial>{children}</AnimatePresence>
      </div>
    </div>
  );
}

function Card({
  component,
  index,
  chaos,
  onChaos,
}: {
  component: ComponentStatus;
  index: number;
  chaos?: Chaos;
  onChaos: () => void;
}) {
  const stoppable = chaos?.stoppable.includes(component.id) ?? false;
  const stopped = chaos?.isStopped(component.id) ?? false;
  const effect = STOP_EFFECT[component.id];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      title={stoppable && effect ? `Stop: ${effect}` : undefined}
      className={`group flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors ${
        component.state === 'down'
          ? 'border-bad/40 bg-bad/5'
          : component.state === 'starting'
            ? 'border-warn/30 bg-warn/5'
            : 'border-line bg-panel-2/60'
      }`}
    >
      <StatusDot state={component.state} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-ink">{component.label}</div>
        <div className="truncate font-mono text-[10px] text-faint">
          {component.state === 'starting'
            ? 'starting…'
            : component.state === 'down'
              ? stopped
                ? 'stopped'
                : 'down'
              : (component.detail ?? component.state)}
        </div>
      </div>
      {stoppable && chaos && (
        <button
          type="button"
          onClick={() => {
            chaos.setStopped(component.id, !stopped);
            onChaos();
          }}
          aria-label={`${stopped ? 'Start' : 'Stop'} ${component.label}`}
          className={`rounded-md p-1 transition ${
            stopped
              ? 'text-ok hover:bg-ok/10'
              : 'text-faint opacity-60 group-hover:opacity-100 hover:bg-bad/10 hover:text-bad'
          }`}
        >
          {stopped ? <Power className="size-3.5" /> : <PowerOff className="size-3.5" />}
        </button>
      )}
    </motion.div>
  );
}
