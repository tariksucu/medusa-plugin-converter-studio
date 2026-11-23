import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConverterStudioClient, USER_AGENT, VERSION } from '../../src/lib/client';
import { ConverterStudioError } from '../../src/lib/errors';
import { API, fakeFetch, happyRoutes, json, KEY, noSleep, view, WEBP } from './helpers';

const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
  version: string;
};

const input = {
  bytes: new Uint8Array([1, 2, 3, 4]),
  fileName: 'shirt.png',
  to: 'webp' as const,
  options: { quality: 'balanced' },
  maxCredits: 1,
  timeoutMs: 60_000,
};

const client = (fetch: ReturnType<typeof fakeFetch>['fetch']) =>
  new ConverterStudioClient({ apiKey: KEY, apiUrl: `${API}/`, fetch, sleep: noSleep });

async function caught(promise: Promise<unknown>): Promise<ConverterStudioError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConverterStudioError) return error;
    throw error;
  }
  throw new Error('Expected a ConverterStudioError');
}

describe('ConverterStudioClient.convert', () => {
  it('uploads, converts, waits and downloads', async () => {
    const api = fakeFetch(
      happyRoutes(WEBP, {
        [`GET ${API}/v1/conversions/up_12345678`]: [
          () => json(200, view({ status: 'processing' })),
          () =>
            json(
              200,
              view({
                status: 'done',
                downloadUrl: 'https://api.test/api/jobs/up_12345678/download?token=t0k',
              }),
            ),
        ],
      }),
    );
    const result = await client(api.fetch).convert(input);
    expect(Buffer.from(result.bytes).equals(Buffer.from(WEBP))).toBe(true);
    expect(result.conversion.status).toBe('done');

    const [upload, put, create, poll1, poll2, download] = api.calls;
    expect(upload).toMatchObject({ method: 'POST', body: { fileName: 'shirt.png', size: 4 } });
    expect(put!.method).toBe('PUT');
    expect(put!.headers['content-type']).toBe('application/octet-stream');
    expect(create!.body).toEqual({
      uploadId: 'up_12345678',
      to: 'webp',
      options: { quality: 'balanced' },
      maxCredits: 1,
    });
    expect(poll1!.url).toMatch(/\/v1\/conversions\/up_12345678\?wait=\d+$/);
    expect(poll2!.method).toBe('GET');
    expect(download!.url).toContain('/jobs/up_12345678/download');
  });

  it('sends the key to the API only, never to the upload or download links', async () => {
    const api = fakeFetch(happyRoutes(WEBP));
    await client(api.fetch).convert(input);
    for (const call of api.calls) {
      const tokenLink = call.url.includes('token=');
      expect(call.headers.authorization).toBe(tokenLink ? undefined : `Bearer ${KEY}`);
      expect(call.headers['user-agent']).toBe(USER_AGENT);
    }
  });

  it("names the plugin with the package's version on its API calls (X-Converter-Studio-Client)", async () => {
    expect(VERSION).toBe(pkg.version);
    expect(USER_AGENT).toBe(`medusa-plugin-converter-studio/${pkg.version}`);
    const api = fakeFetch(happyRoutes(WEBP));
    await client(api.fetch).convert(input);
    const create = api.calls.find((c) => c.method === 'POST' && c.url === `${API}/v1/conversions`);
    expect(create!.headers['x-converter-studio-client']).toBe(`medusa/${pkg.version}`);
    for (const call of api.calls)
      if (!call.url.includes('token='))
        expect(call.headers['x-converter-studio-client']).toBe(`medusa/${pkg.version}`);
  });

  it('reports running out of credits with its code', async () => {
    const api = fakeFetch(
      happyRoutes(WEBP, {
        [`POST ${API}/v1/conversions`]: () =>
          json(402, { error: { code: 'notEnoughCredits', message: 'Not enough credits.' } }),
      }),
    );
    const error = await caught(client(api.fetch).convert(input));
    expect(error.code).toBe('notEnoughCredits');
    expect(error.kind).toBe('credits');
    expect(error.status).toBe(402);
  });

  it('leaves a conversion dearer than maxCredits unconfirmed', async () => {
    const api = fakeFetch(
      happyRoutes(WEBP, {
        [`POST ${API}/v1/conversions`]: () => json(201, view({ status: 'quoted', credits: 3 })),
      }),
    );
    const error = await caught(client(api.fetch).convert(input));
    expect(error.code).toBe('overMaxCredits');
    expect(api.calls.some((c) => c.url.includes('/confirm'))).toBe(false);
  });

  it('passes on the error of a failed conversion', async () => {
    const api = fakeFetch(
      happyRoutes(WEBP, {
        [`GET ${API}/v1/conversions/up_12345678`]: () =>
          json(
            200,
            view({ status: 'failed', error: { code: 'conversionFailed', message: 'It failed.' } }),
          ),
      }),
    );
    expect((await caught(client(api.fetch).convert(input))).code).toBe('conversionFailed');
  });

  it('tries again when the API is busy, waiting as long as it asks', async () => {
    const waits: number[] = [];
    const api = fakeFetch(
      happyRoutes(WEBP, {
        [`POST ${API}/v1/uploads`]: [
          () =>
            json(
              429,
              { error: { code: 'tooManyRequests', message: 'Slow down.' } },
              { 'Retry-After': '7' },
            ),
          () => json(503, { error: { code: 'serverBusy', message: 'Busy.' } }),
          () =>
            json(201, {
              id: 'up_12345678',
              uploadUrl: 'https://api.test/api/v1/uploads/up_12345678?token=t0k',
              method: 'PUT',
              maxBytes: 1e9,
              partBytes: 1e8,
              expiresAt: '',
            }),
        ],
      }),
    );
    const c = new ConverterStudioClient({
      apiKey: KEY,
      apiUrl: API,
      fetch: api.fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await c.convert(input);
    expect(waits).toEqual([7000, 2000]);
  });

  it('does not hammer the API when uploads are paused for hours', async () => {
    const api = fakeFetch(
      happyRoutes(WEBP, {
        [`POST ${API}/v1/uploads`]: () =>
          json(429, { error: { code: 'tooManyUnconverted', message: 'Paused.' } }),
      }),
    );
    expect((await caught(client(api.fetch).convert(input))).code).toBe('tooManyUnconverted');
    expect(api.calls.filter((c) => c.url.endsWith('/v1/uploads'))).toHaveLength(1);
  });

  it('says the key does not work, also without a JSON body', async () => {
    const api = fakeFetch({
      [`GET ${API}/v1/account`]: () => new Response('<html>401</html>', { status: 401 }),
    });
    const error = await caught(client(api.fetch).account());
    expect(error.code).toBe('invalidApiKey');
    expect(error.kind).toBe('auth');
  });

  it('gives up after the network failed a few times', async () => {
    const fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const c = new ConverterStudioClient({
      apiKey: KEY,
      apiUrl: API,
      fetch,
      sleep: noSleep,
      retries: 2,
    });
    expect((await caught(c.convert(input))).code).toBe('network');
  });

  it('stops waiting after the timeout', async () => {
    const api = fakeFetch(
      happyRoutes(WEBP, {
        [`GET ${API}/v1/conversions/up_12345678`]: () => json(200, view({ status: 'processing' })),
      }),
    );
    const error = await caught(client(api.fetch).convert({ ...input, timeoutMs: 1 }));
    expect(error.code).toBe('timeout');
  });

  it('refuses files larger than one upload request', async () => {
    const api = fakeFetch({});
    const big = { ...input, bytes: new Uint8Array(95 * 1024 * 1024 + 1) };
    expect((await caught(client(api.fetch).convert(big))).code).toBe('sourceTooLarge');
    expect(api.calls).toHaveLength(0);
  });
});

describe('ConverterStudioClient.account', () => {
  it('returns the plan and credits without the e-mail address', async () => {
    const api = fakeFetch({
      [`GET ${API}/v1/account`]: () =>
        json(200, {
          email: 'someone@example.com',
          plan: 'pro',
          credits: 1099,
          allowance: { used: 1, limit: 1100, per: 'month' },
          packs: 0,
          renewsAt: '2026-12-21T00:00:00.000Z',
          maxFileBytes: 1073741824,
        }),
    });
    const account = await client(api.fetch).account();
    expect(account).toEqual({
      plan: 'pro',
      credits: 1099,
      allowance: { used: 1, limit: 1100, per: 'month' },
      packs: 0,
      renewsAt: '2026-12-21T00:00:00.000Z',
      maxFileBytes: 1073741824,
    });
  });
});
