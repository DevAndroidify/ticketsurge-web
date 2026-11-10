import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { ActivityFeed } from './components/ActivityFeed';
import { BuyPanel } from './components/BuyPanel';
import { ConnectPanel } from './components/ConnectPanel';
import { CrowdStage } from './components/CrowdStage';
import { FlowDiagram } from './components/FlowDiagram';
import { GuaranteePanel } from './components/GuaranteePanel';
import { Header, LogoMark } from './components/Header';
import { TABS, type Tab } from './components/nav';
import { InfraPanel } from './components/InfraPanel';
import { KafkaPanel } from './components/KafkaPanel';
import { SaleControl } from './components/SaleControl';
import {
  Counters,
  Footer,
  HowItWorks,
  Intro,
  JustNow,
  Note,
  SaleStatus,
} from './components/SalePage';
import { SeatMap, type SeatPicking } from './components/SeatMap';
import { LatencyChart, TrafficChart } from './components/TrafficChart';
import { SectionHeading } from './components/ui';
import type { Backend, SaleOptions } from './lib/backend';
import { DEFAULT_SWARM, type BotPhase } from './lib/bots/swarm';
import type { JourneyEntry } from './lib/buyer/journey';
import {
  isConnected,
  LOCAL_ENDPOINTS,
  proxyEndpoints,
  setConnected,
  type Endpoints,
} from './lib/live/endpoints';
import { LiveBackend, liveBackendAvailable } from './lib/live/live-backend';
import { SimBackend } from './lib/sim/sim-backend';
import { DashboardController, type DashboardState } from './state/dashboard';

// Stable empty values, so a re-render with no sale does not look like new data to the children.
const NO_BOTS: readonly BotPhase[] = [];
const NO_ENTRIES: readonly JourneyEntry[] = [];

/** The sale the header's button starts: 4 sections of 6 rows of 16 seats. */
const DEFAULT_LAYOUT: SaleOptions = { sections: 4, rows: 6, seatsPerRow: 16 };
const DEFAULT_SEATS = DEFAULT_LAYOUT.sections * DEFAULT_LAYOUT.rows * DEFAULT_LAYOUT.seatsPerRow;

/** The simulation holds seats for 45 s (src/lib/sim); the backend's default is much longer. */
const SIM_HOLD_SECONDS = 45;

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
        <div className="flex flex-col items-center gap-4 text-[15px] text-muted">
          <LogoMark className="size-10 animate-pulse" />
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

const SERVED_LOCALLY = ['localhost', '127.0.0.1'].includes(location.hostname);

function Dashboard({ controller, notice }: { controller: DashboardController; notice?: Notice }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const backend = controller.backend;
  const endpoints = backend instanceof LiveBackend ? backend.endpoints : undefined;
  const [connectOpen, setConnectOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('sale');
  const apiUp = state.components.find((c) => c.id === 'api')?.state === 'up';
  const buyer = state.buyer;
  const { phase } = state.sale;
  const busy = phase === 'preparing' || phase === 'running';

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
    void controller.launch(DEFAULT_LAYOUT, {
      ...DEFAULT_SWARM,
      bots: Number.isFinite(bots) && bots > 0 ? Math.min(bots, 2000) : 300,
    });
  }, [apiUp, controller]);

  // The tabs follow the scroll: the active one is the last part whose top has passed a third of
  // the way down the screen.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: Tab = 'sale';
      for (const t of TABS) {
        const top = document.getElementById(t.anchor)?.getBoundingClientRect().top;
        if (t.id !== 'sale' && top !== undefined && top < window.innerHeight / 3) current = t.id;
      }
      // The last part may never reach the top: at the bottom of the page, it is the one in view.
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) current = TABS[TABS.length - 1]?.id ?? current;
      setTab(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
    // A link to #control-room or #how-it-works lands there once the page has rendered.
    const target = location.hash.slice(1);
    const landing = target
      ? requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView())
      : 0;
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(landing);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const goTo = (next: Tab) => {
    const anchor = TABS.find((t) => t.id === next)?.anchor ?? 'top';
    history.replaceState(
      null,
      '',
      next === 'sale' ? location.pathname + location.search : `#${anchor}`,
    );
    if (next === 'sale') window.scrollTo({ top: 0, behavior: 'smooth' });
    else document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' });
  };

  const startSale = () => {
    if (busy) return;
    void controller.launch(DEFAULT_LAYOUT, DEFAULT_SWARM);
  };

  const startLabel =
    phase === 'preparing'
      ? 'Starting…'
      : phase === 'running'
        ? 'Sale running'
        : controller.reusesEvent()
          ? 'Send in the crowd'
          : 'Start a sale';

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-bg text-ink">
        <ConnectPanel
          open={connectOpen}
          onClose={() => {
            setConnectOpen(false);
          }}
        />
        <Header
          tab={tab}
          onTab={goTo}
          endpoints={endpoints}
          onConnect={() => {
            setConnectOpen(true);
          }}
          onDisconnect={disconnect}
          startLabel={startLabel}
          canStart={apiUp && !busy}
          onStart={startSale}
        />

        {notice === 'local-down' && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-ink px-4 py-3 text-[15px] sm:px-8">
            <span className="min-w-0 flex-1">
              Your backend on localhost:3000 is not answering, so this is the simulation in this
              tab. Start it with npm run dev:all and reload.
            </span>
            <button
              type="button"
              onClick={disconnect}
              className="border-0 bg-transparent p-0 font-medium underline underline-offset-4"
            >
              Disconnect
            </button>
          </div>
        )}

        <main id="top">
          <Intro
            people={state.sale.swarm?.bots.length ?? DEFAULT_SWARM.bots}
            seats={state.sale.event?.totalSeats ?? DEFAULT_SEATS}
          />
          <Counters state={state} />
          <SaleStatus state={state} />
          <section className="flex flex-wrap border-b border-ink">
            <div className="flex min-w-0 flex-[2_1_640px] flex-col gap-4 border-b border-ink px-4 pt-7 pb-10 sm:px-8 lg:border-r lg:border-b-0">
              <SeatMap
                event={state.sale.event}
                seats={state.sale.seats}
                socket={state.sale.socket}
                degraded={state.sale.degraded}
                picking={picking}
              />
              <div className="mt-1 ml-4 flex items-start gap-2.5 text-accent-text">
                <svg
                  width="46"
                  height="40"
                  viewBox="0 0 46 40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                  className="flex-none"
                >
                  <path d="M40 36 C30 34 14 30 8 8" />
                  <path d="M3 14 L8 7 L14 12" />
                </svg>
                <Note className="-rotate-[1.5deg] pt-3.5">
                  {endpoints
                    ? "striped means someone's holding it. if they don't pay in time, it's back."
                    : `striped means someone's holding it. they get ${SIM_HOLD_SECONDS} seconds to pay, then it's back.`}
                </Note>
              </div>
            </div>
            <aside aria-label="Your ticket" className="flex min-w-0 flex-[1_1_340px] flex-col">
              <div id="your-ticket" className="border-b border-line px-4 py-7 sm:px-8">
                <BuyPanel
                  buyer={buyer}
                  seats={state.sale.seats}
                  event={state.sale.event}
                  phase={phase}
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
              <div className="px-4 pt-6 pb-7 sm:px-8">
                <JustNow
                  activity={state.sale.swarm?.activity ?? []}
                  startedAt={state.sale.swarm?.startedAt}
                />
              </div>
            </aside>
          </section>
          <ControlRoom controller={controller} state={state} endpoints={endpoints} />
          <HowItWorks
            state={state}
            simulated={!endpoints}
            onControlRoom={() => {
              goTo('control');
            }}
          />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}

/**
 * The control room, as the part of the page you scroll into after the venue: the crowd, a request
 * through the system, the traffic and services, and the proof. Each box rises in as it arrives.
 */
function ControlRoom({
  controller,
  state,
  endpoints,
}: {
  controller: DashboardController;
  state: DashboardState;
  endpoints?: Endpoints;
}) {
  const backend = controller.backend;
  const apiUp = state.components.find((c) => c.id === 'api')?.state === 'up';
  const other = endpoints ? 'sim' : 'live';
  return (
    <section
      id="control-room"
      aria-label="Control room"
      className="scroll-mt-16 space-y-5 border-b border-ink px-4 pt-12 pb-12 sm:px-8"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div className="max-w-2xl">
          <h2 className="m-0 text-[clamp(2rem,4.5vw,3rem)] leading-[1.05] font-semibold tracking-[-0.02em]">
            The control room
          </h2>
          <p className="m-0 mt-2 text-[17px] leading-normal text-muted">
            Everything behind the venue above: the crowd, one request on its way through the system,
            the traffic, every container and service, and the proof.{' '}
            {endpoints ? 'Live from your backend.' : 'Simulated in this tab.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-5 text-[15px]">
          {endpoints && (
            <>
              <a
                className="underline underline-offset-4"
                href={endpoints.grafanaLink}
                target="_blank"
                rel="noreferrer"
              >
                Grafana
              </a>
              <a
                className="underline underline-offset-4"
                href={endpoints.kafkaUiLink}
                target="_blank"
                rel="noreferrer"
              >
                Kafka UI
              </a>
            </>
          )}
          {SERVED_LOCALLY && endpoints?.kind !== 'direct' && (
            <a className="underline underline-offset-4" href={`?mode=${other}#control-room`}>
              Switch to {other === 'live' ? 'live' : 'simulated'}
            </a>
          )}
        </div>
      </motion.div>

      <SectionHeading
        number="1"
        title="The crowd"
        text="Every dot is one buyer. Turn the traffic up while it runs."
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <CrowdStage
          bots={state.sale.swarm?.bots ?? NO_BOTS}
          startedAt={state.sale.swarm?.startedAt}
          step={state.buyer?.step}
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
        number="2"
        title="One request, end to end"
        text="Buy a ticket above and follow it through every service."
      />
      <FlowDiagram
        metrics={state.metrics}
        clientRps={state.clientRps}
        components={state.components}
        journey={state.buyer?.log ?? NO_ENTRIES}
      />

      <SectionHeading
        number="3"
        title="Under load"
        text="Requests by outcome, and every container and service."
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
        number="4"
        title="The proof"
        text="Nothing lost in Kafka, nothing sold twice, checked while it runs."
      />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <KafkaPanel metrics={state.metrics} />
        <LatencyChart history={state.history} />
        <GuaranteePanel swarm={state.sale.swarm} seats={state.sale.seats} />
        <ActivityFeed activity={state.sale.swarm?.activity ?? []} />
      </div>
    </section>
  );
}
