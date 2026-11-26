import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConvertInput, ConvertResult } from '../../src/lib/client';
import { convertImage, mapLimit, uploadName } from '../../src/lib/convert-image';
import { ConverterStudioError } from '../../src/lib/errors';
import { resolveOptions } from '../../src/lib/options';
import { bytes, fakeFetch, JPG, view, WEBP } from './helpers';

const png = new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', 'sample.png')));
const heic = new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', 'sample.heic')));
const SHOP = 'http://shop.test/static';

function converter(result: Uint8Array) {
  const inputs: ConvertInput[] = [];
  return {
    inputs,
    client: {
      convert: async (input: ConvertInput): Promise<ConvertResult> => {
        inputs.push(input);
        return {
          bytes: result,
          conversion: view({ status: 'done', credits: 1, id: 'conv_1' }) as never,
        };
      },
    },
  };
}

const source = (data: Uint8Array) => fakeFetch({ [`GET ${SHOP}/`]: () => bytes(200, data) }).fetch;

describe('convertImage', () => {
  const options = resolveOptions({}, {});

  it('converts a PNG to WebP and reports the sizes', async () => {
    const small = new Uint8Array([...WEBP, 1, 2, 3]);
    const api = converter(small);
    const outcome = await convertImage(
      { client: api.client, fetch: source(png) },
      `${SHOP}/1732000000000-shirt.png`,
      options,
    );
    expect(outcome).toMatchObject({
      status: 'converted',
      from: 'png',
      to: 'webp',
      credits: 1,
      conversionId: 'conv_1',
      sourceSize: png.byteLength,
      resultSize: small.byteLength,
    });
    expect(api.inputs[0]).toMatchObject({
      fileName: '1732000000000-shirt.png',
      to: 'webp',
      maxCredits: 1,
      options: { quality: 'balanced' },
      timeoutMs: 180_000,
    });
  });

  it('asks for the longer side to be at most 2560 px unless told otherwise', async () => {
    const api = converter(new Uint8Array([...WEBP, 1]));
    await convertImage({ client: api.client, fetch: source(png) }, `${SHOP}/a.png`, options);
    await convertImage(
      { client: api.client, fetch: source(png) },
      `${SHOP}/a.png`,
      resolveOptions({ maxSize: null }, {}),
    );
    expect(api.inputs.map((input) => input.options)).toEqual([
      { quality: 'balanced', longSide: '2560' },
      { quality: 'balanced' },
    ]);
  });

  it('names the upload by what the bytes are, not by a wrong extension', async () => {
    const api = converter(new Uint8Array([...WEBP]));
    await convertImage({ client: api.client, fetch: source(heic) }, `${SHOP}/photo.jpg`, options);
    expect(api.inputs[0]!.fileName).toBe('photo.heic');
  });

  it('skips an image already in the target format without calling the API', async () => {
    const api = converter(WEBP);
    const outcome = await convertImage(
      { client: api.client, fetch: source(WEBP) },
      `${SHOP}/x`,
      options,
    );
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'alreadyTarget' });
    expect(api.inputs).toHaveLength(0);
  });

  it('skips formats not among the sources', async () => {
    const api = converter(WEBP);
    const outcome = await convertImage(
      { client: api.client, fetch: source(png) },
      `${SHOP}/a.png`,
      resolveOptions({ sources: ['heic'] }, {}),
    );
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'notSelected' });
    expect(api.inputs).toHaveLength(0);
  });

  it('keeps a JPG or PNG when the result is larger, but always replaces HEIC', async () => {
    const large = new Uint8Array(png.byteLength + 10);
    large.set(WEBP);
    const larger = await convertImage(
      { client: converter(large).client, fetch: source(png) },
      `${SHOP}/a.png`,
      options,
    );
    expect(larger).toMatchObject({ status: 'skipped', reason: 'resultLarger', credits: 1 });

    const bigJpg = new Uint8Array(heic.byteLength + 10);
    bigJpg.set(JPG);
    const fromHeic = await convertImage(
      { client: converter(bigJpg).client, fetch: source(heic) },
      `${SHOP}/a.heic`,
      resolveOptions({ format: 'jpg' }, {}),
    );
    expect(fromHeic.status).toBe('converted');
  });

  it('refuses a result that is not the format asked for', async () => {
    await expect(
      convertImage({ client: converter(JPG).client, fetch: source(png) }, `${SHOP}/a.png`, options),
    ).rejects.toMatchObject({
      code: 'resultDownloadFailed',
    });
  });

  it('explains an image that cannot be downloaded or is no image', async () => {
    const missing = fakeFetch({
      [`GET ${SHOP}/`]: () => new Response('nope', { status: 404 }),
    }).fetch;
    await expect(
      convertImage({ client: converter(WEBP).client, fetch: missing }, `${SHOP}/a.png`, options),
    ).rejects.toMatchObject({
      code: 'sourceDownloadFailed',
    });
    const text = new Uint8Array(Buffer.from('this is not an image at all'));
    await expect(
      convertImage({ client: converter(WEBP).client, fetch: source(text) }, `${SHOP}/a`, options),
    ).rejects.toBeInstanceOf(ConverterStudioError);
  });
});

describe('uploadName', () => {
  it('keeps the name and sets the extension', () => {
    expect(uploadName('https://x.test/a/IMG_1.jpeg', 'jpg')).toBe('IMG_1.jpg');
    expect(uploadName('https://x.test/abc', 'png')).toBe('abc.png');
  });
});

describe('mapLimit', () => {
  it('runs at most `limit` at once and keeps the order of the results', async () => {
    let running = 0;
    let most = 0;
    const results = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(most).toBe(2);
  });

  it('starts nothing more after stop()', async () => {
    const results = await mapLimit([1, 2, 3, 4], 1, async (n, stop) => {
      if (n === 2) stop();
      return n;
    });
    expect(results).toEqual([1, 2, undefined, undefined]);
  });
});
