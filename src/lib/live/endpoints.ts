/** Where the live backend's parts are reached from the browser. */
export interface Endpoints {
  /** `proxy`: through the dev server, run locally. `direct`: straight to the visitor's localhost. */
  kind: 'proxy' | 'direct';
  api: string;
  /** WebSocket URL of the realtime gateway, without the query string. */
  ws: string;
  prometheus: string;
  grafanaHealth: string;
  kafkaUiHealth: string;
  /** Links in the header to the backend's own UIs. */
  grafanaLink: string;
  kafkaUiLink: string;
}

/** `npm run dev` here: the Vite proxy forwards these paths (vite.config.ts). */
export function proxyEndpoints(): Endpoints {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return {
    kind: 'proxy',
    api: '/api',
    ws: `${scheme}://${location.host}/ws`,
    prometheus: '/prom',
    grafanaHealth: '/grafana/api/health',
    kafkaUiHealth: '/kafka-ui/actuator/health',
    grafanaLink: __GRAFANA_URL__,
    kafkaUiLink: __KAFKA_UI_URL__,
  };
}

/**
 * A hosted copy of the site talking to a backend on the visitor's own machine, at the ports in
 * the backend's .env.example. The API must list this site in CORS_ORIGINS. Prometheus's query API
 * allows any origin by default; Grafana, Kafka UI and Prometheus's /-/ready are only probed for
 * reachability, which needs no CORS.
 */
export const LOCAL_ENDPOINTS: Endpoints = {
  kind: 'direct',
  api: 'http://localhost:3000',
  ws: 'ws://localhost:3001/ws',
  prometheus: 'http://localhost:9090',
  grafanaHealth: 'http://localhost:3002/api/health',
  kafkaUiHealth: 'http://localhost:8080/actuator/health',
  grafanaLink: 'http://localhost:3002',
  kafkaUiLink: 'http://localhost:8080',
};

const STORAGE_KEY = 'ticketsurge.connect';

/** True when the visitor chose "Connect my backend" on this browser. */
export function isConnected(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'local';
  } catch {
    return false;
  }
}

export function setConnected(connected: boolean): void {
  try {
    if (connected) localStorage.setItem(STORAGE_KEY, 'local');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private window): the choice lasts for this page load only.
  }
}

/**
 * - `ok`: the API answered and allows this site.
 * - `cors`: something answers on the port, but the API does not list this site in CORS_ORIGINS.
 * - `down`: nothing answers.
 */
export type LocalCheck = 'ok' | 'cors' | 'down';

/** Tells "not running" apart from "running but blocked by CORS", so the panel can say which. */
export async function checkLocalBackend(
  api = LOCAL_ENDPOINTS.api,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalCheck> {
  try {
    const response = await fetchImpl(`${api}/health`, { signal: AbortSignal.timeout(3000) });
    return response.status === 200 || response.status === 503 ? 'ok' : 'down';
  } catch {
    // A CORS failure and a refused connection look the same to fetch. An opaque request needs no
    // CORS, so if it gets through, the API is running and only the allowlist is missing.
    try {
      await fetchImpl(`${api}/health`, { mode: 'no-cors', signal: AbortSignal.timeout(3000) });
      return 'cors';
    } catch {
      return 'down';
    }
  }
}
