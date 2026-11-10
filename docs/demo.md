# How the demo works

## Modes

| Mode                | When                                                          | Data comes from                                                             |
| ------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Live, proxied**   | This site runs locally and its proxy reaches the API          | The real API, realtime gateway, Prometheus, Grafana and Kafka UI            |
| **Live, connected** | A hosted copy, after the visitor pressed "Connect my backend" | The same services, called straight on the visitor's `localhost`             |
| **Simulated**       | No backend answers, or `?mode=sim`                            | `src/lib/sim/sim-backend.ts`, a model of the backend running in the browser |

When the site runs locally, force a mode with `?mode=live` or `?mode=sim`; the header link switches
between them. The ports and paths for each live mode are in `src/lib/live/endpoints.ts`.

Both modes implement the same `Backend` interface (`src/lib/backend.ts`), so the buyers, panels and
checks are identical. The simulation follows the backend's rules: all-or-nothing holds, one active
booking per seat, idempotency keys, per-user rate limits, an outbox, and Kafka consumer groups that
process at a limited rate, so lag builds up and drains. It uses shorter timings than the backend
(45 s holds, 30 s payment deadline) so a sale finishes in a couple of minutes.

## Run both locally (live, proxied)

1. Start the backend as described in its README: `npm run infra:up`, migrations, the seed, topics,
   and the services. `npm run dev:all` starts all eight in one terminal (`dev:api`, `dev:realtime`,
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

## Connect my backend (hosted copy)

The site is deployed at https://ticketsurge-web.vercel.app. A hosted copy (Vercel, Netlify, any
static host) has no proxy. A visitor can still drive the real system: they run the backend on
their own machine, press **Connect my backend** in the header, and the page calls `localhost`
directly. Nothing goes through the host.

1. In the backend: `git clone`, `npm install`, `cp .env.example .env`. The backend's
   `.env.example` already lists https://ticketsurge-web.vercel.app in `CORS_ORIGINS`; another copy
   of the site needs its own address added there (the panel shows the exact line). Then
   `npm run infra:up`, build, migrate, seed, create the Kafka topics, and `npm run dev:all`.
2. Press **Connect**. The panel tells "nothing is running" apart from "running, but CORS_ORIGINS
   does not list this site". The choice is remembered in this browser; **Disconnect** forgets it.

Chrome and Edge ask once before a public site may reach `localhost` (choose Allow); the API answers
that check (Private Network Access). Safari may block a secure page from calling `http://localhost`.

## Which event is sold

The page never creates events: that needs an admin account, and admin credentials do not belong in
a browser. Live sales use the newest event on sale that still has free seats, starting with the
500-seat event from `npm run db:seed`. When it sells out, `npm run demo:new-event` in the backend
opens a fresh one. The venue layout choice applies to the simulation only.

Bots sign up with `bot-<run>-<n>@demo.ticketsurge.test` addresses. Each sign-up costs the API one
scrypt hash, so sign-ups run 12 at a time.

## Things to try

1. **Buy a ticket.** "Get in line" opens an event if there is none, then takes you through the
   queue, seat selection, a hold with a countdown, and payment. It uses the same `Backend` calls as
   the bots.
2. **Race the crowd.** While you are choosing seats, press "Send in the crowd" in the header. It
   joins your event instead of replacing it, and you queue and compete with it for real.
3. **Increase the traffic.** In the Control room, during a sale, +50, +200 and +500 add a burst of
   buyers, and "Steady arrivals" keeps adding them every second. A crowd is capped at 2,000.
4. **Lose on purpose.** Choose a seat and wait for a bot to take it, then press Hold. The 409 and
   the "changed nothing" outcome are the guarantee at work.

Payment needs no card: `payment-service` simulates the charge and declines a share of them. The
confirmation shows the booking, because the API has no endpoint for reading ticket codes.

In live mode every bot runs in the browser tab, so the browser's connection limit, rather than the
backend, sets how many requests per second a large crowd can produce. The k6 scripts in the backend
repo are the way to measure real capacity.

## The page

The design follows `design/live-venue.html`: white page, one green accent, square corners, and 1px
lines instead of cards (Jost, plus Caveat for at most three handwritten notes). Red is kept for
409s and 429s.

It is one long page. The header stays at the top, and its three links (The sale, Control room, How
it works) scroll to each part; the underline follows as you scroll. Boxes and rules animate in as
they come into view, unless the system asks for reduced motion. Top to bottom:

- **Counters**: waiting in line, seats left, booked, and seats sold twice, which must stay at 0,
  each with a line of context. Below them, a status line and a bar showing where every buyer is.
- **Tonight's venue**: the stage and each section with its price and seats left. Open seats are
  green, held seats are striped, sold seats are grey. Updated from the WebSocket, and reloaded
  every 5 s and after reconnecting, because Redis Pub/Sub keeps no history.
- **You're in line**: your purchase: your place in the queue with a 20-square progress bar, the
  four steps, the hold countdown, and the result. A lost race shows the 409.
- **Just now**: the crowd's latest moves as plain sentences (`src/components/feed.ts`).
- **The control room** (`#control-room`), in four chapters: the crowd, one request end to end,
  under load, and the proof. Its panels are listed below.
- **How it works** (`#how-it-works`): one ticket's path in seven steps (the line, 429s, the
  all-or-nothing hold, PostgreSQL's final call, Kafka, how a booking ends, live seat updates). Each
  step says where to see it on the page and shows this sale's number for it. Beside it: **What it
  doesn't do**, and **Words on this page**, a short glossary (hold, 409, 429, 202, outbox,
  consumer lag, idempotency key).

The control room's panels:

- **The crowd**: every dot is one buyer, moving between the stages of the sale. Your dot is labelled.
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
