import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/**
 * Lets every visitor start a fresh flash sale without any admin setup.
 *
 * The backend only creates events for accounts in its ADMIN_EMAILS. This dev/preview server holds
 * such an account itself and creates events on the browser's behalf through POST /demo/events, so
 * no credentials ever reach the page. With the defaults it needs no configuration at all:
 * admin@ticketsurge.local is in the backend's default ADMIN_EMAILS, and on first use the account is
 * registered with a random password kept in a local, gitignored file.
 */

export interface DemoAdminOptions {
  apiUrl: string;
  email: string;
  /** From DEMO_ADMIN_PASSWORD. When empty, a random one is generated and kept in `secretFile`. */
  password: string | undefined;
  secretFile: string;
  fetch?: typeof fetch;
}

/** A problem the visitor can fix, reported with its HTTP status. */
export class DemoAdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Signs in as the demo admin, registering the account on first use. */
export class DemoAdmin {
  private token: string | undefined;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: DemoAdminOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  /** Creates an event; the backend validates the body. Signs in again once if the token expired. */
  async createEvent(body: unknown): Promise<{ status: number; body: unknown }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.signIn();
      const response = await this.post('/admin/events', body, token);
      if (response.status === 401 && attempt === 0) {
        this.token = undefined;
        continue;
      }
      if (response.status === 403) {
        throw new DemoAdminError(
          403,
          `${this.options.email} is not in the backend's ADMIN_EMAILS. Add it there, or set DEMO_ADMIN_EMAIL in this site's .env to an address that is.`,
        );
      }
      return response;
    }
    throw new DemoAdminError(502, 'The backend rejected the demo admin token twice.');
  }

  private async signIn(): Promise<string> {
    if (this.token) return this.token;
    const credentials = { email: this.options.email, password: this.password() };
    const login = await this.post('/auth/login', credentials);
    if (login.status === 200) return this.remember(login.body);
    if (login.status !== 401) throw unexpected('sign in', login);

    const registered = await this.post('/auth/register', credentials);
    if (registered.status === 201) return this.remember(registered.body);
    if (registered.status === 409) {
      throw new DemoAdminError(
        409,
        `${this.options.email} already exists with a different password. Set DEMO_ADMIN_PASSWORD in this site's .env to that password, or DEMO_ADMIN_EMAIL to a new address in ADMIN_EMAILS.`,
      );
    }
    throw unexpected('register', registered);
  }

  private remember(body: unknown): string {
    const token = (body as { accessToken?: unknown } | undefined)?.accessToken;
    if (typeof token !== 'string') throw new DemoAdminError(502, 'The backend sent no token.');
    this.token = token;
    return token;
  }

  private password(): string {
    if (this.options.password) return this.options.password;
    try {
      const saved = JSON.parse(readFileSync(this.options.secretFile, 'utf8')) as {
        password?: unknown;
      };
      if (typeof saved.password === 'string' && saved.password.length >= 8) return saved.password;
    } catch {
      // No file yet: generate a password below.
    }
    const password = randomBytes(18).toString('base64url');
    writeFileSync(this.options.secretFile, `${JSON.stringify({ password }, null, 2)}\n`, {
      mode: 0o600,
    });
    return password;
  }

  private async post(path: string, body: unknown, token?: string) {
    let response: Response;
    try {
      response = await this.fetch(`${this.options.apiUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new DemoAdminError(502, `The API at ${this.options.apiUrl} did not answer.`);
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = { message: text };
    }
    return { status: response.status, body: parsed };
  }
}

function unexpected(action: string, response: { status: number; body: unknown }) {
  const message = (response.body as { message?: unknown } | undefined)?.message;
  return new DemoAdminError(
    502,
    `Demo admin could not ${action} (HTTP ${response.status}${typeof message === 'string' ? `: ${message}` : ''}).`,
  );
}

const MAX_BODY_BYTES = 16 * 1024;

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new DemoAdminError(413, 'Request body too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new DemoAdminError(400, 'Request body is not JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

/** Vite plugin: POST /demo/events on both the dev and the preview server. */
export function demoEvents(options: DemoAdminOptions): Plugin {
  const admin = new DemoAdmin(options);
  const handle = (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST') {
      send(response, 405, { message: 'Use POST.' });
      return;
    }
    readBody(request)
      .then((body) => admin.createEvent(body))
      .then((result) => {
        send(response, result.status, result.body);
      })
      .catch((error: unknown) => {
        const status = error instanceof DemoAdminError ? error.status : 500;
        send(response, status, { message: error instanceof Error ? error.message : 'Failed.' });
      });
  };
  return {
    name: 'ticketsurge-demo-events',
    configureServer(server) {
      server.middlewares.use('/demo/events', handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/demo/events', handle);
    },
  };
}
