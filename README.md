# TicketSurge Web

A live demonstration site for [TicketSurge](https://github.com/DevAndroidify/ticketsurge), a
flash-sale ticketing backend built with Kafka, Redis and PostgreSQL.

Send a crowd of virtual buyers at a sale, then turn the traffic up while it runs. They queue, hold
seats, lose races, retry, book and pay through the real API. Buy a ticket yourself in the middle of
it and watch your own request travel through the architecture, step by step. The site also shows
which services are up, requests per second, the seat map filling over WebSocket, Kafka lag building
and draining, and a live check that no seat is ever sold twice.

![Dashboard during a live flash sale](docs/screenshot.png)

## Run it

```bash
nvm use
npm install
npm run dev        # http://localhost:5173
```

With the TicketSurge backend running, the dashboard connects to it (**live** mode). Without one it
runs an in-browser model of the backend (**simulated** mode), so it also works as a static site.

More detail: [docs/demo.md](docs/demo.md).

Built with React, TypeScript, Vite, Tailwind CSS and Motion.
