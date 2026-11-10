import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityFeed } from './components/ActivityFeed';
import { BuyPanel } from './components/BuyPanel';
import { CrowdStage } from './components/CrowdStage';
import { FlowDiagram } from './components/FlowDiagram';
import { GuaranteePanel } from './components/GuaranteePanel';
import { Header, LogoMark } from './components/Header';
import { HeroStats } from './components/HeroStats';
import { InfraPanel } from './components/InfraPanel';
import { KafkaPanel } from './components/KafkaPanel';
import { SaleControl } from './components/SaleControl';
import { SeatMap, type SeatPicking } from './components/SeatMap';
import { LatencyChart, TrafficChart } from './components/TrafficChart';
import { TryIt } from './components/TryIt';
import { SectionHeading } from './components/ui';
import type { Backend } from './lib/backend';
import { DEFAULT_SWARM, type BotPhase } from './lib/bots/swarm';
import type { JourneyEntry } from './lib/buyer/journey';
import { ConnectPanel } from './components/ConnectPanel';
import { isConnected, LOCAL_ENDPOINTS, proxyEndpoints, setConnected } from './lib/live/endpoints';
import { LiveBackend, liveBackendAvailable } from './lib/live/live-backend';
import { SimBackend } from './lib/sim/sim-backend';
import { DashboardController } from './state/dashboard';

// Stable empty values, so a re-render with no sale does not look like new data to the children.
const NO_BOTS: readonly BotPhase[] = [];
const NO_ENTRIES: readonly JourneyEntry[] = [];

/** Why the page fell back to the simulation, if it did. */
type Notice = 'no-backend' | 'local-down';

/**
 * 1. ?mode=sim forces the simulation.
 * 2. After "Connect my backend", the visitor's localhost, when it answers.
 * 3. The dev server's proxy (this site run locally with npm run dev); ?mode=live forces it.
 * 4. Otherwise the simulation.
 */
async function chooseBackend(): Promise<{ backend: Backend; notice?: Notice }> {
  const requested = new URLSearchParams(location.search).get('mode');
  if (requested === 'sim') return { backend: new SimBackend() };
  if (isConnected()) {
    if (await liveBackendAvailable(LOCAL_ENDPOINTS)) {
      return { backend: new LiveBackend(LOCAL_ENDPOINTS) };
    }
    return { backend: new SimBackend(), notice: 'local-down' };
  }
  const proxy = proxyEndpoints();
  if (requested === 'live' || (await liveBackendAvailable(proxy))) {
    return { backend: new LiveBackend(proxy) };
  }
  return { backend: new SimBackend(), notice: 'no-backend' };
}

export function App() {
  const [controller, setController] = useState<DashboardController>();
  const [notice, setNotice] = useState<Notice>();

  useEffect(() => {
    let created: DashboardController | undefined;
    let cancelled = false;
    void chooseBackend().then(({ backend, notice: why }) => {
      if (cancelled) {
        backend.dispose();
        return;
      }
      created = new DashboardController(backend);
      setController(created);
      setNotice(why);
    });
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, []);

  if (!controller) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-4 text-sm font-medium text-muted">
          <LogoMark className="size-12 animate-bounce" />
          Looking for a TicketSurge backend…
        </div>
      </div>
    );
  }
  return <Dashboard controller={controller} notice={notice} />;
}

function disconnect() {
  setConnected(false);
  location.reload();
}

function Dashboard({ controller, notice }: { controller: DashboardController; notice?: Notice }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const backend = controller.backend;
  const endpoints = backend instanceof LiveBackend ? backend.endpoints : undefined;
  const [connectOpen, setConnectOpen] = useState(false);
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

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-8 sm:py-8">
      <ConnectPanel
        open={connectOpen}
        onClose={() => {
          setConnectOpen(false);
        }}
      />
      <Header
        endpoints={endpoints}
        onConnect={() => {
          setConnectOpen(true);
        }}
        onDisconnect={disconnect}
        aside={
          <TryIt
            mode={backend.mode}
            phase={state.sale.phase}
            canStart={apiUp}
            onLaunch={() => {
              scrollTo('the-sale');
              const { phase } = state.sale;
              if (phase !== 'preparing' && phase !== 'running') {
                void controller.launch({ sections: 4, rows: 6, seatsPerRow: 16 }, DEFAULT_SWARM);
              }
            }}
            onBuy={() => {
              scrollTo('your-ticket');
              void controller.startBuying();
            }}
          />
        }
      />

      {notice && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-kafka/40 bg-kafka/10 px-5 py-3 text-sm text-kafka-ink">
          <span className="min-w-0 flex-1">
            {notice === 'local-down'
              ? 'Your backend on localhost:3000 is not answering, so this is the in-browser simulation. Start it with npm run dev:all and reload.'
              : 'This is the in-browser simulation. Run the real backend on your machine and connect this page to it.'}
          </span>
          {notice === 'local-down' ? (
            <button type="button" onClick={disconnect} className="font-semibold underline">
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConnectOpen(true);
              }}
              className="font-semibold underline"
            >
              Connect my backend
            </button>
          )}
        </div>
      )}

      <HeroStats state={state} />

      <SectionHeading
        id="the-sale"
        number="01"
        title="The sale"
        text="Send in a crowd and watch every buyer move through it."
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
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

      <SectionHeading
        id="your-ticket"
        number="02"
        title="Your ticket"
        text="Race the crowd for a seat, and follow your request through every service."
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0 space-y-5">
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

      <SectionHeading
        id="under-load"
        number="03"
        title="Under load"
        text="Traffic by outcome, and every container and service. Stop one and see what happens."
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
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

      <SectionHeading
        id="the-proof"
        number="04"
        title="The proof"
        text="Nothing lost, nothing sold twice, checked live."
      />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <KafkaPanel metrics={state.metrics} />
        <LatencyChart history={state.history} />
        <GuaranteePanel swarm={state.sale.swarm} seats={state.sale.seats} />
        <ActivityFeed activity={state.sale.swarm?.activity ?? []} />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 pb-4 text-sm text-muted">
        <span className="flex items-center gap-2 font-display font-semibold text-ink">
          <LogoMark className="size-6" /> TicketSurge
        </span>
        <span>
          Redis handles the rush. PostgreSQL makes the final decision. Kafka runs everything after
          the booking.
        </span>
      </footer>
    </div>
  );
}
