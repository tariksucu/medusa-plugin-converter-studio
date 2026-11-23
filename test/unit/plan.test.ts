import { resolveOptions } from '../../src/lib/options';
import {
  buildImageUpdate,
  buildRestoreUpdate,
  CREDITS_RETRY_MS,
  ORIGINAL_URL_KEY,
  planConversions,
  planRestorations,
  STALE_PROCESSING_MS,
  type ConversionRecord,
  type ProductData,
} from '../../src/lib/plan';
import { productImageStatus, summarize } from '../../src/lib/status';

const S = 'http://shop.test/static';
const NOW = Date.parse('2026-11-22T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const options = resolveOptions({}, {});

const product = (overrides: Partial<ProductData> = {}): ProductData => ({
  id: 'prod_1',
  thumbnail: `${S}/a.png`,
  images: [
    { id: 'img_b', url: `${S}/b.jpg`, rank: 1 },
    { id: 'img_a', url: `${S}/a.png`, rank: 0 },
    { id: 'img_c', url: `${S}/c.webp`, rank: 2 },
  ],
  variants: [
    { id: 'var_1', thumbnail: `${S}/b.jpg` },
    { id: 'var_2', thumbnail: null },
  ],
  ...overrides,
});

let n = 0;
const record = (overrides: Partial<ConversionRecord>): ConversionRecord => ({
  id: `csic_${++n}`,
  image_id: 'img_a',
  target: 'image',
  source_url: `${S}/a.png`,
  result_url: null,
  status: 'failed',
  reason: 'conversionFailed',
  created_at: ago(1000),
  ...overrides,
});

const plan = (records: ConversionRecord[], trigger: 'auto' | 'manual' = 'auto', p = product()) =>
  planConversions({ product: p, records, options, trigger, now: NOW }).map(
    (c) => c.image_id ?? c.target,
  );

describe('planConversions', () => {
  it('takes the images in formats to convert and leaves modern ones', () => {
    expect(plan([])).toEqual(['img_b', 'img_a']);
  });

  it('converts a thumbnail of its own, and images with unknown names, but no SVG or data URLs', () => {
    const p = product({
      thumbnail: `${S}/thumb.heic`,
      images: [
        { id: 'img_x', url: 'https://cdn.test/images/9f8e7d' },
        { id: 'img_y', url: `${S}/logo.svg` },
        { id: 'img_z', url: 'data:image/png;base64,AAAA' },
      ],
    });
    expect(plan([], 'auto', p)).toEqual(['img_x', 'thumbnail']);
  });

  it('only the images asked for, when given', () => {
    expect(
      planConversions({
        product: product(),
        records: [],
        options,
        trigger: 'manual',
        imageIds: ['img_b'],
        now: NOW,
      }).map((c) => c.image_id),
    ).toEqual(['img_b']);
  });

  it('automatic runs do not repeat failures of the image itself, manual runs do', () => {
    const failed = [record({ reason: 'unsupportedConversion' })];
    expect(plan(failed, 'auto')).toEqual(['img_b']);
    expect(plan(failed, 'manual')).toEqual(['img_b', 'img_a']);
  });

  it('automatic runs try again after running out of credits, once an hour has passed', () => {
    expect(plan([record({ reason: 'notEnoughCredits', created_at: ago(5 * 60_000) })])).toEqual([
      'img_b',
    ]);
    expect(
      plan([record({ reason: 'notEnoughCredits', created_at: ago(CREDITS_RETRY_MS + 1) })]),
    ).toEqual(['img_b', 'img_a']);
  });

  it('leaves restored images and kept originals alone; a manual run converts restored ones again', () => {
    expect(plan([record({ status: 'restored', reason: null })])).toEqual(['img_b']);
    expect(plan([record({ status: 'restored', reason: null })], 'manual')).toEqual([
      'img_b',
      'img_a',
    ]);
    expect(plan([record({ status: 'skipped', reason: 'resultLarger' })], 'manual')).toEqual([
      'img_b',
    ]);
  });

  it('does not start an image another run is converting, unless that run stopped long ago', () => {
    expect(plan([record({ status: 'processing', reason: null, created_at: ago(1000) })])).toEqual([
      'img_b',
    ]);
    expect(
      plan([
        record({ status: 'processing', reason: null, created_at: ago(STALE_PROCESSING_MS + 1) }),
      ]),
    ).toEqual(['img_b', 'img_a']);
  });

  it('goes by the newest record', () => {
    const records = [
      record({ reason: 'notEnoughCredits', created_at: ago(10_000) }),
      record({ status: 'restored', reason: null, created_at: ago(1000) }),
    ];
    expect(plan(records, 'auto')).toEqual(['img_b']);
  });

  it('converts from the first original when an image was converted before', () => {
    const p = product({
      images: [{ id: 'img_a', url: `${S}/a.webp`, metadata: { [ORIGINAL_URL_KEY]: `${S}/a.png` } }],
      thumbnail: null,
    });
    const avif = resolveOptions({ format: 'avif' }, {});
    const [candidate] = planConversions({
      product: p,
      records: [],
      options: avif,
      trigger: 'auto',
      now: NOW,
    });
    expect(candidate).toMatchObject({ url: `${S}/a.webp`, download_url: `${S}/a.png` });
  });
});

describe('buildImageUpdate', () => {
  it('swaps the converted URLs, keeps every image in order, and updates thumbnails', () => {
    const update = buildImageUpdate(product(), [
      {
        record_id: 'r1',
        image_id: 'img_a',
        target: 'image',
        source_url: `${S}/a.png`,
        result_url: `${S}/a.webp`,
      },
      {
        record_id: 'r2',
        image_id: 'img_b',
        target: 'image',
        source_url: `${S}/b.jpg`,
        result_url: `${S}/b.webp`,
      },
    ]);
    expect(update.changed).toBe(true);
    expect(update.images).toEqual([
      { id: 'img_a', url: `${S}/a.webp`, metadata: { [ORIGINAL_URL_KEY]: `${S}/a.png` } },
      { id: 'img_b', url: `${S}/b.webp`, metadata: { [ORIGINAL_URL_KEY]: `${S}/b.jpg` } },
      { id: 'img_c', url: `${S}/c.webp` },
    ]);
    expect(update.thumbnail).toBe(`${S}/a.webp`);
    expect(update.variants).toEqual([{ id: 'var_1', thumbnail: `${S}/b.webp` }]);
    expect([...update.applied]).toEqual(['r1', 'r2']);
  });

  it('leaves an image that was changed while it was converted', () => {
    const p = product({
      images: [{ id: 'img_a', url: `${S}/new.png`, rank: 0 }],
      thumbnail: null,
      variants: [],
    });
    const update = buildImageUpdate(p, [
      {
        record_id: 'r1',
        image_id: 'img_a',
        target: 'image',
        source_url: `${S}/a.png`,
        result_url: `${S}/a.webp`,
      },
    ]);
    expect(update.changed).toBe(false);
    expect(update.applied.size).toBe(0);
    expect(update.images).toEqual([{ id: 'img_a', url: `${S}/new.png` }]);
  });

  it('keeps other metadata and the very first original', () => {
    const p = product({
      images: [
        {
          id: 'img_a',
          url: `${S}/a.webp`,
          metadata: { alt: 'Shirt', [ORIGINAL_URL_KEY]: `${S}/a.png` },
        },
      ],
      thumbnail: null,
      variants: [],
    });
    const update = buildImageUpdate(p, [
      {
        record_id: 'r1',
        image_id: 'img_a',
        target: 'image',
        source_url: `${S}/a.webp`,
        result_url: `${S}/a.avif`,
      },
    ]);
    expect(update.images[0]).toEqual({
      id: 'img_a',
      url: `${S}/a.avif`,
      metadata: { alt: 'Shirt', [ORIGINAL_URL_KEY]: `${S}/a.png` },
    });
  });

  it('updates a thumbnail of its own', () => {
    const p = product({ thumbnail: `${S}/t.heic` });
    const update = buildImageUpdate(p, [
      {
        record_id: 'r9',
        image_id: null,
        target: 'thumbnail',
        source_url: `${S}/t.heic`,
        result_url: `${S}/t.webp`,
      },
    ]);
    expect(update.thumbnail).toBe(`${S}/t.webp`);
    expect(update.changed).toBe(true);
  });
});

describe('restore', () => {
  it('puts back the originals that are still shown converted', () => {
    const converted = product({
      thumbnail: `${S}/a.webp`,
      images: [
        {
          id: 'img_a',
          url: `${S}/a.webp`,
          rank: 0,
          metadata: { [ORIGINAL_URL_KEY]: `${S}/a.png`, alt: 'x' },
        },
        { id: 'img_b', url: `${S}/b-edited.jpg`, rank: 1 },
      ],
      variants: [{ id: 'var_1', thumbnail: `${S}/a.webp` }],
    });
    const records = [
      record({ id: 'r1', status: 'converted', reason: null, result_url: `${S}/a.webp` }),
      record({
        id: 'r2',
        image_id: 'img_b',
        source_url: `${S}/b.jpg`,
        status: 'converted',
        reason: null,
        result_url: `${S}/b.webp`,
      }),
    ];
    const restorations = planRestorations(converted, records);
    expect(restorations.map((r) => r.record_id)).toEqual(['r1']);
    const update = buildRestoreUpdate(converted, restorations);
    expect(update.images).toEqual([
      { id: 'img_a', url: `${S}/a.png`, metadata: { alt: 'x' } },
      { id: 'img_b', url: `${S}/b-edited.jpg` },
    ]);
    expect(update.thumbnail).toBe(`${S}/a.png`);
    expect(update.variants).toEqual([{ id: 'var_1', thumbnail: `${S}/a.png` }]);
  });
});

describe('productImageStatus', () => {
  it("shows each image's state and sums up", () => {
    const p = product({
      thumbnail: `${S}/a.webp`,
      images: [
        { id: 'img_a', url: `${S}/a.webp`, rank: 0 },
        { id: 'img_b', url: `${S}/b.jpg`, rank: 1 },
        { id: 'img_c', url: `${S}/c.webp`, rank: 2 },
        { id: 'img_d', url: `${S}/d.png`, rank: 3 },
        { id: 'img_e', url: `${S}/e.png`, rank: 4 },
      ],
    });
    const records = [
      record({
        status: 'converted',
        reason: null,
        result_url: `${S}/a.webp`,
        source_size: 1000,
        result_size: 400,
      }),
      record({
        image_id: 'img_b',
        source_url: `${S}/b.jpg`,
        status: 'failed',
        reason: 'notEnoughCredits',
      }),
      record({
        image_id: 'img_d',
        source_url: `${S}/d.png`,
        status: 'skipped',
        reason: 'resultLarger',
      }),
    ];
    const images = productImageStatus(p, records, options, NOW);
    expect(images.map((i) => [i.image_id, i.state, i.reason])).toEqual([
      ['img_a', 'converted', null],
      ['img_b', 'failed', 'notEnoughCredits'],
      ['img_c', 'ignored', null],
      ['img_d', 'kept', 'resultLarger'],
      ['img_e', 'pending', null],
    ]);
    expect(images[0]!.original_url).toBe(`${S}/a.png`);
    const summary = summarize(images);
    expect(summary).toMatchObject({
      converted: 1,
      failed: 1,
      kept: 1,
      pending: 1,
      ignored: 1,
      convertible: 2,
      saved_bytes: 600,
    });
    expect(summary.blocked_by).toBe('notEnoughCredits');
  });
});
