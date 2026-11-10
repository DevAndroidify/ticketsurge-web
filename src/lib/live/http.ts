import type { Outcome } from '../backend';

export interface RequestOptions {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

/**
 * Calls the API (`url` is the full address: the proxy's `/api/...` or the visitor's localhost) and
 * turns every response, including network failures, into an Outcome. Error bodies follow the
 * backend's `{ error: { code, message } }`.
 */
export async function request<T extends object>(
  method: string,
  url: string,
  options: RequestOptions = {},
): Promise<Outcome<T>> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    return {
      ok: false,
      http: 0,
      code: 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'request failed',
    };
  }

  const text = await response.text();
  const json = parseJson(text);
  if (response.ok) {
    return { ok: true, http: response.status, ...((json ?? {}) as T) };
  }

  const error = (json as ErrorBody | undefined)?.error;
  const retryAfter = Number(response.headers.get('retry-after'));
  return {
    ok: false,
    http: response.status,
    code: typeof error?.code === 'string' ? error.code : `HTTP_${response.status}`,
    message: typeof error?.message === 'string' ? error.message : response.statusText,
    ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
  };
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * True when a plain GET answers 2xx within the timeout. `opaque` is for another origin that sends
 * no CORS headers: the status cannot be read then, so any answer at all counts as reachable.
 */
export async function reachable(url: string, opaque = false, timeoutMs = 2500): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      ...(opaque ? { mode: 'no-cors' as const } : {}),
    });
    return opaque || response.ok;
  } catch {
    return false;
  }
}
