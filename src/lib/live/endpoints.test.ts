import { describe, expect, it } from 'vitest';
import { checkLocalBackend } from './endpoints';

/** A fetch that fails CORS requests (like a browser without the allowlist) when `cors` is false. */
function fakeFetch({
  running,
  cors,
  status = 200,
}: {
  running: boolean;
  cors: boolean;
  status?: number;
}) {
  return (_url: string | URL | Request, init?: RequestInit) => {
    if (!running) return Promise.reject(new TypeError('Failed to fetch'));
    if (init?.mode === 'no-cors') return Promise.resolve(new Response(null, { status: 200 }));
    if (!cors) return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(new Response('{}', { status }));
  };
}

describe('checkLocalBackend', () => {
  it('is ok when the API answers and allows this site', async () => {
    expect(await checkLocalBackend('http://x', fakeFetch({ running: true, cors: true }))).toBe(
      'ok',
    );
  });

  it('is still ok when a dependency is down (503 with the health body)', async () => {
    const fetch503 = fakeFetch({ running: true, cors: true, status: 503 });
    expect(await checkLocalBackend('http://x', fetch503)).toBe('ok');
  });

  it('reports a missing CORS_ORIGINS entry when only the opaque request gets through', async () => {
    expect(await checkLocalBackend('http://x', fakeFetch({ running: true, cors: false }))).toBe(
      'cors',
    );
  });

  it('reports down when nothing answers', async () => {
    expect(await checkLocalBackend('http://x', fakeFetch({ running: false, cors: false }))).toBe(
      'down',
    );
  });
});
