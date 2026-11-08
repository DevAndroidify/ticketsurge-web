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
   services (`dev:api`, `dev:realtime`, `dev:admission`, `dev:booking-worker`, `dev:payment`,
   `dev:tickets`, `dev:notifications`, `dev:analytics`).
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

**Fresh event per run.** By default a run reuses the newest event that is on sale and still has
free seats, such as the seeded demo event. To create a new event each time, open "Fresh event each
run (admin)" and enter an account listed in the backend's `ADMIN_EMAILS`. The account is signed up
on first use. Another option is `npm run loadtest:prepare -- 1` in the backend, which creates a
fresh 500-seat event.

Bots sign up with `bot-<run>-<n>@demo.ticketsurge.test` addresses. Each sign-up costs the API one
scrypt hash, so sign-ups run 12 at a time.

## The panels

- **Infrastructure**: Docker containers and Node services. In simulated mode they boot one by one,
  and Redis, the booking worker, payment, ticket and notification services can be stopped to see
  what happens (503s and retries, outbox backlog, Kafka lag, expiries and refunds).
- **Flow diagram**: every connection carries dots at the rate the metrics report, colored by
  technology. Nodes turn red when their component is down.
- **Requests per second**: stacked by outcome. The 409 band is the backend turning away a second
  buyer for the same seat.
- **Flash sale**: the crowd's funnel, from sign-up to confirmed, failed, expired or missed out.
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
