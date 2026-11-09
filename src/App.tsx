import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityFeed } from './components/ActivityFeed';
import { BuyPanel } from './components/BuyPanel';
import { CrowdStage } from './components/CrowdStage';
import { FlowDiagram } from './components/FlowDiagram';
import { GuaranteePanel } from './components/GuaranteePanel';
import { Header } from './components/Header';
import { HeroStats } from './components/HeroStats';
import { InfraPanel } from './components/InfraPanel';
import { KafkaPanel } from './components/KafkaPanel';
import { SaleControl } from './components/SaleControl';
import { SeatMap, type SeatPicking } from './components/SeatMap';
import { LatencyChart, TrafficChart } from './components/TrafficChart';
import type { Backend } from './lib/backend';
import { DEFAULT_SWARM, type BotPhase } from './lib/bots/swarm';
import type { JourneyEntry } from './lib/buyer/journey';
import { LiveBackend, liveBackendAvailable } from './lib/live/live-backend';
import { SimBackend } from './lib/sim/sim-backend';
import { DashboardController } from './state/dashboard';

// Stable empty values, so a re-render with no sale does not look like new data to the children.
const NO_BOTS: readonly BotPhase[] = [];
const NO_ENTRIES: readonly JourneyEntry[] = [];

/** ?mode=live or ?mode=sim forces a mode; otherwise live is used when the API answers. */
async function chooseBackend(): Promise<{ backend: Backend; fellBack: boolean }> {
  const requested = new URLSearchParams(location.search).get('mode');
  if (requested === 'sim') return { backend: new SimBackend(), fellBack: false };
  if (requested === 'live') return { backend: new LiveBackend(), fellBack: false };
  const live = await liveBackendAvailable();
  return { backend: live ? new LiveBackend() : new SimBackend(), fellBack: !live };
}

export function App() {
  const [controller, setController] = useState<DashboardController>();
  const [fellBack, setFellBack] = useState(false);

  useEffect(() => {
    let created: DashboardController | undefined;
    let cancelled = false;
    void chooseBackend().then(({ backend, fellBack: fb }) => {
      if (cancelled) {
        backend.dispose();
        return;
      }
      created = new DashboardController(backend);
      setController(created);
      setFellBack(fb);
    });
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, []);

  if (!controller) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted">
        Looking for a TicketSurge backend…
      </div>
    );
  }
  return <Dashboard controller={controller} fellBack={fellBack} />;
}

function Dashboard({
  controller,
  fellBack,
}: {
  controller: DashboardController;
  fellBack: boolean;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const backend = controller.backend;
  const apiUp = state.components.find((c) => c.id === 'api')?.state === 'up';
  const buyer = state.buyer;

  const picking = useMemo<SeatPicking>(
    () => ({
      active: buyer?.step === 'picking',
      selected: new Set(buyer?.selected),
      // Seats that are no longer the visitor's once the purchase has failed.
      mine: new Set(
        buyer?.step === 'held' ||
          buyer?.step === 'booking' ||
          buyer?.step === 'paying' ||
          buyer?.step === 'confirmed'
          ? buyer.seats
          : [],
      ),
      onToggle: (seatId) => {
        controller.toggleSeat(seatId);
      },
    }),
    [buyer, controller],
  );

  // ?autostart launches a sale with the default settings as soon as the API is up, for kiosk
  // screens and recordings. ?bots=N changes the crowd size.
  const autostarted = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!apiUp || autostarted.current || !params.has('autostart')) return;
    autostarted.current = true;
    const bots = Number(params.get('bots') ?? DEFAULT_SWARM.bots);
    void controller.launch(
      { sections: 4, rows: 6, seatsPerRow: 16 },
      { ...DEFAULT_SWARM, bots: Number.isFinite(bots) && bots > 0 ? Math.min(bots, 2000) : 300 },
    );
  }, [apiUp, controller]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6 sm:py-6">
      <Header mode={backend.mode} />

      {fellBack && (
        <div className="rounded-xl border border-kafka/30 bg-kafka/5 px-4 py-2.5 text-xs text-muted">
          No backend answered on <code className="text-ink">/api/health</code>, so this is the
          in-browser simulation. To watch the real services, start the backend and run this site
          with <code className="text-ink">npm run dev</code>, then reload.
        </div>
      )}

      <HeroStats state={state} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <CrowdStage
          bots={state.sale.swarm?.bots ?? NO_BOTS}
          startedAt={state.sale.swarm?.startedAt}
          step={buyer?.step}
          rps={Math.max(state.metrics?.http.total ?? 0, state.clientRps)}
        />
        <SaleControl
          mode={backend.mode}
          sale={state.sale}
          clientRps={state.clientRps}
          canLaunch={apiUp}
          reusesEvent={controller.reusesEvent()}
          onLaunch={(options, swarm) => void controller.launch(options, swarm)}
          onStop={() => {
            controller.stopSale();
          }}
          onSurge={(count) => {
            controller.addTraffic(count);
          }}
          onArrivalRate={(perSecond) => {
            controller.setArrivalRate(perSecond);
          }}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <SeatMap
            event={state.sale.event}
            seats={state.sale.seats}
            socket={state.sale.socket}
            degraded={state.sale.degraded}
            picking={picking}
          />
          <FlowDiagram
            metrics={state.metrics}
            clientRps={state.clientRps}
            components={state.components}
            journey={buyer?.log ?? NO_ENTRIES}
          />
        </div>
        <BuyPanel
          buyer={buyer}
          seats={state.sale.seats}
          event={state.sale.event}
          phase={state.sale.phase}
          canStart={apiUp}
          error={state.sale.error}
          onStart={() => void controller.startBuying()}
          onHold={() => {
            controller.holdSeats();
          }}
          onPay={() => {
            controller.pay();
          }}
          onRelease={() => {
            controller.releaseSeats();
          }}
          onReset={() => {
            controller.endJourney();
          }}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <TrafficChart history={state.history} mode={backend.mode} />
        <InfraPanel
          components={state.components}
          mode={backend.mode}
          chaos={backend.chaos}
          onChaos={() => {
            controller.refresh();
          }}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KafkaPanel metrics={state.metrics} />
        <LatencyChart history={state.history} />
        <GuaranteePanel swarm={state.sale.swarm} seats={state.sale.seats} />
        <ActivityFeed activity={state.sale.swarm?.activity ?? []} />
      </div>

      <footer className="pt-2 pb-4 text-center text-[11px] text-faint">
        Redis handles the rush, PostgreSQL makes the final decision, Kafka runs everything after the
        booking.
      </footer>
    </div>
  );
}
