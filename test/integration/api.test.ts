/**
 * The conversion logic against a real Converter Studio API. Spends a few credits, so it runs
 * only when asked:
 *
 *   CONVERTER_STUDIO_TEST_API_URL=https://converter.studio/api \
 *   CONVERTER_STUDIO_TEST_API_KEY_FILE=/path/to/key-file \
 *   npm run test:integration
 *
 * The key is read from the file (never from the command line, never printed).
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { ConverterStudioClient } from '../../src/lib/client';
import { convertImage } from '../../src/lib/convert-image';
import { sniffFormat } from '../../src/lib/formats';
import { resolveOptions } from '../../src/lib/options';

const apiUrl = process.env.CONVERTER_STUDIO_TEST_API_URL;
const keyFile = process.env.CONVERTER_STUDIO_TEST_API_KEY_FILE;
const enabled = Boolean(apiUrl && keyFile);
const fixtures = join(__dirname, '..', 'fixtures');

(enabled ? describe : describe.skip)('Converter Studio API (live)', () => {
  jest.setTimeout(240_000);
  const apiKey = enabled ? readFileSync(keyFile!, 'utf8').trim() : '';
  const client = new ConverterStudioClient({ apiKey, apiUrl: apiUrl ?? '' });
  let server: Server;
  let base = '';

  beforeAll(async () => {
    // Stands in for the store's file storage: serves the sample images over HTTP.
    server = createServer((req, res) => {
      try {
        const data = readFileSync(
          join(fixtures, (req.url ?? '/').replace(/^\/+/, '').replace(/[^a-z.]/g, '')),
        );
        res.writeHead(200, { 'Content-Length': data.length });
        res.end(data);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("reads the account's plan and credits", async () => {
    const account = await client.account();
    expect(['guest', 'pro', 'premium']).toContain(account.plan);
    expect(typeof account.credits).toBe('number');
    expect(account).not.toHaveProperty('email');
  });

  it('converts sample.png to WebP', async () => {
    const outcome = await convertImage(
      { client },
      `${base}/sample.png`,
      resolveOptions({ apiKey, apiUrl }, {}),
    );
    expect(outcome.status).toBe('converted');
    if (outcome.status !== 'converted') return;
    expect(sniffFormat(outcome.bytes)).toBe('webp');
    expect(outcome.resultSize).toBeLessThan(outcome.sourceSize);
    expect(outcome.credits).toBe(1);
  });

  it('converts sample.heic to JPG', async () => {
    const outcome = await convertImage(
      { client },
      `${base}/sample.heic`,
      resolveOptions({ apiKey, apiUrl, format: 'jpg' }, {}),
    );
    expect(outcome.status).toBe('converted');
    if (outcome.status !== 'converted') return;
    expect(outcome.from).toBe('heic');
    expect(sniffFormat(outcome.bytes)).toBe('jpg');
  });

  it('converts sample.jpg to AVIF with a size limit', async () => {
    const options = resolveOptions(
      { apiKey, apiUrl, format: 'avif', maxSize: 800, onlyIfSmaller: false },
      {},
    );
    const outcome = await convertImage({ client }, `${base}/sample.jpg`, options);
    expect(outcome.status).toBe('converted');
    if (outcome.status === 'converted') expect(sniffFormat(outcome.bytes)).toBe('avif');
  });

  it('answers a key that does not work with invalidApiKey', async () => {
    const bad = new ConverterStudioClient({
      apiKey: 'cvs_live_not_a_real_key',
      apiUrl: apiUrl ?? '',
    });
    await expect(bad.account()).rejects.toMatchObject({ code: 'invalidApiKey' });
  });
});
