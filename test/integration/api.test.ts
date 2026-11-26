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
import { deflateSync } from 'node:zlib';
import { ConverterStudioClient } from '../../src/lib/client';
import { convertImage } from '../../src/lib/convert-image';
import { sniffFormat } from '../../src/lib/formats';
import { resolveOptions } from '../../src/lib/options';

/** A PNG of `width` × `height` grey pixels (stored with zlib, as PNG wants). */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer) => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const row = Buffer.alloc(1 + width * 3, 0x80);
  row[0] = 0; // no filter
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A WebP's width and height (lossy, lossless or extended). */
function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = Buffer.from(bytes);
  const kind = b.toString('latin1', 12, 16);
  if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8 ')
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

const LARGE_PNG = png(4000, 2000);

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
      if (req.url === '/large.png') {
        res.writeHead(200, { 'Content-Length': LARGE_PNG.length });
        res.end(LARGE_PNG);
        return;
      }
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

  it('scales a large photo down to 2560 px by default', async () => {
    const outcome = await convertImage(
      { client },
      `${base}/large.png`,
      resolveOptions({ apiKey, apiUrl }, {}),
    );
    expect(outcome.status).toBe('converted');
    if (outcome.status !== 'converted') return;
    expect(webpSize(outcome.bytes)).toEqual({ width: 2560, height: 1280 });
  });

  it('answers a key that does not work with invalidApiKey', async () => {
    const bad = new ConverterStudioClient({
      apiKey: 'cvs_live_not_a_real_key',
      apiUrl: apiUrl ?? '',
    });
    await expect(bad.account()).rejects.toMatchObject({ code: 'invalidApiKey' });
  });
});
