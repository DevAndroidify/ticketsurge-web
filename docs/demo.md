# How the demo works

## Two modes

| Mode          | When                                             | Data comes from                                                             |
| ------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| **Live**      | The dev server's proxy reaches `GET /api/health` | The real API, realtime gateway, Prometheus, Grafana and Kafka UI            |
| **Simulated** | No backend answers, or `?mode=sim`               | `src/lib/sim/sim-backend.ts`, a model of the backend running in the browser |

Force a mode with `?mode=live` or `?mode=sim`. The header link switches between them.

Both modes implement the same `Backend` interface (`src/lib/backend.ts`), so the buyers, panels and
checks are identical. The simulation follows the backend's rules: all-or-nothing holds, one active
booking per seat, idempotency keys, per-user rate limits, an outbox, and Kafka consumer groups that
process at a limited rate, so lag builds up and drains. It uses shorter timings than the backend
(45 s holds, 30 s payment deadline) so a sale finishes in a couple of minutes.

## Live mode setup

1. Start the backend as described in its README: `npm run infra:up`, migrations, topics, and the
   services. `npm run dev:all` starts all eight in one terminal (`dev:api`, `dev:realtime`,
   `dev:admission`, `dev:booking-worker`, `dev:payment`, `dev:tickets`, `dev:notifications`,
   `dev:analytics`).
2. Here: `npm run dev`. The site opens in live mode.

The backend sends no CORS headers, so the browser only talks to the Vite server, which proxies:

| Path        | Default target          | Used for                                                     |
| ----------- | ----------------------- | ------------------------------------------------------------ |
| `/api`      | `http://localhost:3000` | REST API and `GET /health` (PostgreSQL, Redis, Kafka status) |
| `/ws`       | `http://localhost:3001` | WebSocket seat updates                                       |
| `/prom`     | `http://localhost:9090` | Prometheus queries and `up` for every Node service           |
| `/grafana`  | `http://localhost:3002` | Grafana health                                               |
| `/kafka-ui` | `http://localhost:8080` | Kafka UI health                                              |

Change the targets in `.env` (copy `.env.example`). `npm run preview` serves a production build with
the same proxy.

**A fresh event every run, with no setup.** Creating events needs an account in the backend's
`ADMIN_EMAILS`, so the browser never does it. The Vite dev/preview server does it instead, through
`POST /demo/events` (`server/demo-events.ts`): it signs in as `admin@ticketsurge.local`, which is
in the backend's default `ADMIN_EMAILS`, and creates the event. On first use it registers that
account with a random password, kept in `.demo-admin.json` (gitignored). No credentials reach the
page. Set `DEMO_ADMIN_EMAIL` or `DEMO_ADMIN_PASSWORD` in `.env` only if your backend uses another
admin address, or the account already exists with a password you chose. Where `/demo/events` does
not exist (a static host), the newest event that still has free seats is reused.

Bots sign up with `bot-<run>-<n>@demo.ticketsurge.test` addresses. Each sign-up costs the API one
scrypt hash, so sign-ups run 12 at a time.

## Things to try

1. **Buy a ticket.** "Join the sale" opens an event if there is none, then takes you through the
   queue, seat selection, a hold with a countdown, and payment. It uses the same `Backend` calls as
   the bots.
2. **Race the crowd.** While you are choosing seats, press "Send in the crowd". It joins your event
   instead of replacing it, and you queue and compete with it for real.
3. **Increase the traffic.** During a sale, +50, +200 and +500 add a burst of buyers, and "Steady
   arrivals" keeps adding them every second. A crowd is capped at 2,000 buyers.
4. **Lose on purpose.** Choose a seat and wait for a bot to take it, then press Hold. The 409 and
   the "changed nothing" outcome are the guarantee at work.

Payment needs no card: `payment-service` simulates the charge and declines a share of them. The
confirmed card shows the booking, because the API has no endpoint for reading ticket codes.

In live mode every bot runs in the browser tab, so the browser's connection limit, rather than the
backend, sets how many requests per second a large crowd can produce. The k6 scripts in the backend
repo are the way to measure real capacity.

## The panels

- **The crowd**: every dot is one buyer, moving between the stages of the sale. Your dot is labelled.
- **Buy a ticket yourself**: your purchase, plus "What just happened" with each request's real HTTP
  status and time.
- **Infrastructure**: Docker containers and Node services. In simulated mode they boot one by one,
  and Redis, the booking worker, payment, ticket and notification services can be stopped to see
  what happens (503s and retries, outbox backlog, Kafka lag, expiries and refunds).
- **Flow diagram**: every connection carries dots at the rate the metrics report, colored by
  technology. Nodes turn red when their component is down. A bright comet follows each step of your
  own purchase. Requests are drawn as you make them. The browser only sees the booking's final
  status, so the asynchronous part is drawn in the architecture's order once that status is known.
- **Requests per second**: stacked by outcome. The 409 band is the backend turning away a second
  buyer for the same seat.
- **Flash sale**: crowd settings, traffic controls while a sale runs, and the crowd's funnel from
  sign-up to confirmed, failed, expired or missed out.
- **Seat map**: updated from the WebSocket, and reloaded every 5 s and after reconnecting, because
  Redis Pub/Sub keeps no history.
- **Kafka consumers**: lag and throughput per consumer group, plus the outbox backlog.
- **Guarantees**: checked from the buyers' side: no seat confirmed for two buyers, duplicate
  booking requests return one booking, and confirmed seats show as sold.

## URL options

| Option                     | Effect                                                                    |
| -------------------------- | ------------------------------------------------------------------------- |
| `?mode=live` / `?mode=sim` | Force a mode                                                              |
| `?autostart`               | Launch a sale as soon as the API is up (for kiosk screens and recordings) |
| `?bots=500`                | Crowd size for `?autostart`                                               |

## Development

```bash
npm run lint       # ESLint (type-aware) + Prettier
npm test           # Vitest: simulation rules, swarm invariants, parsing, chart helpers
npm run build      # type-check and production build into dist/
```

The swarm tests run whole sales on a virtual clock with seeded randomness and assert that no seat is
ever sold twice.
