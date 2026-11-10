import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';
import { demoEvents } from './server/demo-events';

/**
 * The backend sends no CORS headers, so in live mode every request goes through this dev server:
 * the browser only ever talks to its own origin. Targets come from .env (see .env.example).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = (name: string, fallback: string) => env[name] ?? fallback;

  const strip = (prefix: string, url: string): ProxyOptions => ({
    target: url,
    changeOrigin: true,
    rewrite: (path) => path.slice(prefix.length) || '/',
  });

  const proxy: Record<string, ProxyOptions> = {
    '/api': strip('/api', target('API_URL', 'http://localhost:3000')),
    '/ws': { target: target('REALTIME_URL', 'http://localhost:3001'), ws: true },
    '/prom': strip('/prom', target('PROMETHEUS_URL', 'http://localhost:9090')),
    '/grafana': strip('/grafana', target('GRAFANA_URL', 'http://localhost:3002')),
    '/kafka-ui': strip('/kafka-ui', target('KAFKA_UI_URL', 'http://localhost:8080')),
  };

  return {
    // Relative asset paths, so the built site works from any folder (e.g. GitHub Pages).
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      // Fresh events for every run, created server-side so the page needs no admin account.
      demoEvents({
        apiUrl: target('API_URL', 'http://localhost:3000'),
        email: target('DEMO_ADMIN_EMAIL', 'admin@ticketsurge.local'),
        password: env.DEMO_ADMIN_PASSWORD,
        secretFile: '.demo-admin.json',
      }),
    ],
    // Links in the header. Only these two URLs reach the browser; nothing else from .env does.
    define: {
      __GRAFANA_URL__: JSON.stringify(target('GRAFANA_URL', 'http://localhost:3002')),
      __KAFKA_UI_URL__: JSON.stringify(target('KAFKA_UI_URL', 'http://localhost:8080')),
    },
    server: { port: Number(target('WEB_PORT', '5173')), proxy },
    preview: { port: Number(target('WEB_PORT', '5173')), proxy },
    test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
  };
});
