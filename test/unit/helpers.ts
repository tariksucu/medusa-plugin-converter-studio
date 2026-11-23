import type { FetchLike } from '../../src/lib/client';

export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export const bytes = (status: number, data: Uint8Array) =>
  new Response(Buffer.from(data), { status });

export const API = 'https://api.test/api';
export const KEY = 'cvs_live_unit_test_key';

/** A fetch that answers from a table of `METHOD url-prefix` → handler, and records every call. */
export function fakeFetch(routes: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const used = new Map<string, number>();
  const fetch: FetchLike = async (url, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    let body: unknown = init.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // Not JSON.
      }
    }
    const call = { method, url, headers, body };
    calls.push(call);
    const key = Object.keys(routes)
      .filter((k) => {
        const [m, prefix] = k.split(' ');
        return m === method && url.startsWith(prefix!);
      })
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`No fake route for ${method} ${url}`);
    const handler = routes[key]!;
    if (Array.isArray(handler)) {
      const n = used.get(key) ?? 0;
      used.set(key, n + 1);
      return handler[Math.min(n, handler.length - 1)]!(call);
    }
    return handler(call);
  };
  return { fetch, calls };
}

export function view(overrides: Record<string, unknown> = {}) {
  return {
    id: 'up_12345678',
    status: 'queued',
    from: 'png',
    to: 'webp',
    inputName: 'a.png',
    inputSize: 100,
    credits: 1,
    maxCredits: 1,
    progress: null,
    outputName: null,
    outputSize: null,
    downloadUrl: null,
    expiresAt: null,
    error: null,
    next: '',
    ...overrides,
  };
}

/** The happy path of the API, converting to WebP with `result` as the converted bytes. */
export function happyRoutes(result: Uint8Array, extra: Record<string, Handler | Handler[]> = {}) {
  return {
    [`POST ${API}/v1/uploads`]: () =>
      json(201, {
        id: 'up_12345678',
        uploadUrl: 'https://api.test/api/v1/uploads/up_12345678?token=t0k',
        method: 'PUT',
        maxBytes: 1e9,
        partBytes: 95 * 1024 * 1024,
        expiresAt: new Date().toISOString(),
      }),
    [`PUT ${API}/v1/uploads/up_12345678`]: () => json(200, { id: 'up_12345678', status: 'ready' }),
    [`POST ${API}/v1/conversions`]: () => json(201, view({ status: 'queued' })),
    [`GET ${API}/v1/conversions/up_12345678`]: () =>
      json(
        200,
        view({
          status: 'done',
          downloadUrl: 'https://api.test/api/jobs/up_12345678/download?token=t0k',
        }),
      ),
    [`GET ${API}/jobs/up_12345678/download`]: () => bytes(200, result),
    ...extra,
  };
}

/** The first bytes of a WebP file (enough for the format check). */
export const WEBP = new Uint8Array(Buffer.from('RIFF\x10\0\0\0WEBPVP8 \0\0\0\0', 'latin1'));
export const JPG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1,
]);
export const noSleep = async () => {};
