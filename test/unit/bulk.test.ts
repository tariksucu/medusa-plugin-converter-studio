import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { bulkDone, bulkProgress, estimateBulk, startBulk } from '../../src/lib/bulk';
import { readLimit } from '../../src/lib/http';
import { resolveOptions } from '../../src/lib/options';
import type { ConversionRecord, ProductData } from '../../src/lib/plan';
import { CONVERTER_STUDIO_MODULE } from '../../src/modules/converter-studio';
import { convertProductImagesWorkflow } from '../../src/workflows/convert-product-images';

jest.mock('../../src/modules/converter-studio', () => ({ CONVERTER_STUDIO_MODULE: 'cs' }));
jest.mock('../../src/workflows/convert-product-images', () => ({
  convertProductImagesWorkflow: jest.fn(),
}));

const S = 'http://shop.test/static';
const workflow = convertProductImagesWorkflow as unknown as jest.Mock;

/** Three products: 3 images to convert, 2 already WebP, 1 GIF left alone, 2 more to convert. */
const catalog: ProductData[] = [
  {
    id: 'prod_1',
    thumbnail: `${S}/p1-a.jpg`,
    images: [
      { id: 'img_1a', url: `${S}/p1-a.jpg`, rank: 0 },
      { id: 'img_1b', url: `${S}/p1-b.png`, rank: 1 },
      { id: 'img_1c', url: `${S}/p1-c.webp`, rank: 2 },
    ],
  },
  {
    id: 'prod_2',
    thumbnail: null,
    images: [
      { id: 'img_2a', url: `${S}/p2-a.webp`, rank: 0 },
      { id: 'img_2b', url: `${S}/p2-b.gif`, rank: 1 },
    ],
  },
  {
    id: 'prod_3',
    thumbnail: `${S}/p3-a.jpg`,
    images: [
      { id: 'img_3a', url: `${S}/p3-a.jpg`, rank: 0 },
      { id: 'img_3b', url: `${S}/p3-b.heic`, rank: 1 },
      { id: 'img_3c', url: `${S}/p3-c.jpg`, rank: 2 },
    ],
  },
];

function container(records: (ConversionRecord & { product_id: string })[] = []) {
  const options = resolveOptions({ apiKey: 'cvs_live_unit' }, {});
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: {
      graph: async ({ pagination }: { pagination: { skip: number; take: number } }) => ({
        data: catalog.slice(pagination.skip, pagination.skip + pagination.take),
        metadata: { count: catalog.length },
      }),
    },
    [ContainerRegistrationKeys.LOGGER]: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    [CONVERTER_STUDIO_MODULE]: {
      getOptions: () => options,
      listImageConversions: async (filters: { product_id: string[] }) =>
        records.filter((r) => filters.product_id.includes(r.product_id)),
    },
  };
  return { resolve: (key: string) => services[key] } as unknown as MedusaContainer;
}

/** A workflow run that converts every image it is given (1 credit each, one kept original). */
const groups: string[] = [];

function fakeRuns() {
  const inputs: { product_id: string; image_ids: string[] | null }[] = [];
  groups.length = 0;
  workflow.mockImplementation(() => ({
    run: async ({
      input,
      context,
    }: {
      input: { product_id: string; image_ids: string[] | null };
      context?: { eventGroupId?: string };
    }) => {
      inputs.push(input);
      groups.push(context?.eventGroupId ?? '');
      const product = catalog.find((p) => p.id === input.product_id)!;
      const tried = input.image_ids?.length ?? product.images.length;
      return {
        result: {
          product_id: input.product_id,
          converted: tried - 1,
          skipped: 1,
          failed: 0,
          credits: tried,
          credits_kept: 1,
          saved_bytes: 1000,
          stopped_by: null,
        },
      };
    },
  }));
  return inputs;
}

describe('estimateBulk', () => {
  it('counts the images to send (one credit each) without spending anything', async () => {
    const inputs = fakeRuns();
    const kept = {
      id: 'csic_1',
      product_id: 'prod_3',
      image_id: 'img_3c',
      target: 'image' as const,
      source_url: `${S}/p3-c.jpg`,
      result_url: null,
      status: 'skipped' as const,
      reason: 'resultLarger',
      created_at: new Date().toISOString(),
    };
    expect(await estimateBulk(container([kept]))).toEqual({
      products: 3,
      products_to_convert: 2,
      convert: 4,
      already_target: 2,
      left: 2,
      credits: 4,
    });
    expect(inputs).toEqual([]);
  });
});

describe('startBulk with a limit (a sample)', () => {
  it('tries only that many images, product by product, and reports what they cost', async () => {
    const inputs = fakeRuns();
    expect(startBulk(container(), 3)).toBe(true);
    await bulkDone();
    // prod_1 gives its two images, prod_2 has none to convert, prod_3 gives one: three in all.
    expect(inputs).toEqual([
      { product_id: 'prod_1', trigger: 'bulk', image_ids: ['img_1a', 'img_1b'] },
      { product_id: 'prod_3', trigger: 'bulk', image_ids: ['img_3a'] },
    ]);
    // Each run is marked as the plugin's own, so its product update starts no automatic
    // conversion of the product's other images (which would spend more than the sample).
    expect(groups).toHaveLength(2);
    for (const group of groups) expect(group).toMatch(/^converter-studio-/);
    expect(bulkProgress()).toMatchObject({
      running: false,
      limit: 3,
      images_done: 3,
      converted: 1,
      skipped: 2,
      credits: 3,
      credits_kept: 2,
      stopped_by: null,
    });
  });

  it('without a limit converts every product as before', async () => {
    const inputs = fakeRuns();
    expect(startBulk(container())).toBe(true);
    await bulkDone();
    expect(inputs.map((i) => [i.product_id, i.image_ids])).toEqual([
      ['prod_1', null],
      ['prod_2', null],
      ['prod_3', null],
    ]);
    expect(bulkProgress()).toMatchObject({ limit: null, products_done: 3, images_done: 8 });
  });
});

describe('startBulk out of credits', () => {
  it('stops at the first product that ran out, with a sample too', async () => {
    const inputs: string[] = [];
    workflow.mockImplementation(() => ({
      run: async ({ input }: { input: { product_id: string } }) => {
        inputs.push(input.product_id);
        return {
          result: {
            product_id: input.product_id,
            converted: 0,
            skipped: 0,
            failed: 2,
            credits: 0,
            credits_kept: 0,
            saved_bytes: 0,
            stopped_by: 'notEnoughCredits',
          },
        };
      },
    }));
    startBulk(container(), 5);
    await bulkDone();
    expect(inputs).toEqual(['prod_1']);
    expect(bulkProgress()).toMatchObject({
      running: false,
      stopped_by: 'notEnoughCredits',
      images_done: 2,
      failed: 2,
      credits: 0,
    });
  });
});

describe('readLimit', () => {
  it('takes a whole number from 1 to 1000, or nothing', () => {
    expect(readLimit({})).toBeNull();
    expect(readLimit({ action: 'start', limit: 10 })).toBe(10);
    expect(() => readLimit({ limit: 0 })).toThrow(/limit/);
    expect(() => readLimit({ limit: 2.5 })).toThrow(/limit/);
    expect(() => readLimit({ limit: '10' })).toThrow(/limit/);
    expect(() => readLimit({ limit: 5000 })).toThrow(/limit/);
  });
});
