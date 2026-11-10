import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DemoAdmin, DemoAdminError } from './demo-events';

interface Call {
  path: string;
  body: unknown;
  auth: string | undefined;
}

/** A fake API: each path answers from a queue of [status, body] pairs (the last one repeats). */
function fakeApi(routes: Record<string, [number, unknown][]>) {
  const calls: Call[] = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const headers = init.headers as Record<string, string>;
    calls.push({ path, body: JSON.parse(init.body as string), auth: headers.authorization });
    const queue = routes[path] ?? [[404, { message: 'not found' }]];
    const [status, body] = (queue.length > 1 ? queue.shift() : queue[0]) ?? [500, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
  return { calls, fetchFn };
}

const EVENT = { name: 'Flash sale', sections: [] };

describe('DemoAdmin', () => {
  let dir: string;
  let secretFile: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'demo-admin-'));
    secretFile = join(dir, '.demo-admin.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const admin = (fetchFn: typeof fetch, password?: string) =>
    new DemoAdmin({
      apiUrl: 'http://api.test',
      email: 'admin@ticketsurge.local',
      password,
      secretFile,
      fetch: fetchFn,
    });

  it('registers on first use with a generated password, keeps it, and creates the event', async () => {
    const api = fakeApi({
      '/auth/login': [[401, { message: 'invalid credentials' }]],
      '/auth/register': [[201, { accessToken: 'token-1' }]],
      '/admin/events': [[201, { id: 'event-1' }]],
    });
    const result = await admin(api.fetchFn).createEvent(EVENT);

    expect(result).toEqual({ status: 201, body: { id: 'event-1' } });
    const saved = JSON.parse(readFileSync(secretFile, 'utf8')) as { password: string };
    expect(saved.password.length).toBeGreaterThanOrEqual(16);
    expect(api.calls.map((c) => c.path)).toEqual([
      '/auth/login',
      '/auth/register',
      '/admin/events',
    ]);
    expect(api.calls[1]?.body).toEqual({
      email: 'admin@ticketsurge.local',
      password: saved.password,
    });
    expect(api.calls[2]).toMatchObject({ body: EVENT, auth: 'Bearer token-1' });
  });

  it('reuses the saved password and the token for later events', async () => {
    const first = fakeApi({
      '/auth/login': [[401, {}]],
      '/auth/register': [[201, { accessToken: 'token-1' }]],
      '/admin/events': [[201, {}]],
    });
    await admin(first.fetchFn).createEvent(EVENT);
    const saved = JSON.parse(readFileSync(secretFile, 'utf8')) as { password: string };

    const second = fakeApi({
      '/auth/login': [[200, { accessToken: 'token-2' }]],
      '/admin/events': [[201, {}]],
    });
    const restarted = admin(second.fetchFn);
    await restarted.createEvent(EVENT);
    await restarted.createEvent(EVENT);

    expect(second.calls[0]?.body).toEqual({
      email: 'admin@ticketsurge.local',
      password: saved.password,
    });
    expect(second.calls.map((c) => c.path)).toEqual([
      '/auth/login',
      '/admin/events',
      '/admin/events',
    ]);
  });

  it('signs in again once when the token has expired', async () => {
    const api = fakeApi({
      '/auth/login': [
        [200, { accessToken: 'old' }],
        [200, { accessToken: 'new' }],
      ],
      '/admin/events': [
        [401, {}],
        [201, { id: 'event-2' }],
      ],
    });
    const result = await admin(api.fetchFn, 'configured-password').createEvent(EVENT);

    expect(result.status).toBe(201);
    expect(api.calls.filter((c) => c.path === '/admin/events').map((c) => c.auth)).toEqual([
      'Bearer old',
      'Bearer new',
    ]);
  });

  it('explains an account that exists with another password', async () => {
    const api = fakeApi({
      '/auth/login': [[401, {}]],
      '/auth/register': [[409, {}]],
    });
    const error = await admin(api.fetchFn)
      .createEvent(EVENT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoAdminError);
    expect((error as DemoAdminError).message).toMatch(/DEMO_ADMIN_PASSWORD/);
  });

  it('explains an email that is not an admin', async () => {
    const api = fakeApi({
      '/auth/login': [[200, { accessToken: 'token' }]],
      '/admin/events': [[403, {}]],
    });
    await expect(admin(api.fetchFn, 'configured-password').createEvent(EVENT)).rejects.toThrow(
      /ADMIN_EMAILS/,
    );
  });
});
