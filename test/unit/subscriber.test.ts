import type { SubscriberArgs } from '@medusajs/framework';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { resolveOptions } from '../../src/lib/options';
import { isOwnEvent, ownRunContext } from '../../src/lib/runs';
import convertProductImagesHandler from '../../src/subscribers/convert-product-images';
import { convertProductImagesWorkflow } from '../../src/workflows/convert-product-images';

jest.mock('../../src/modules/converter-studio', () => ({ CONVERTER_STUDIO_MODULE: 'cs' }));
jest.mock('../../src/workflows/convert-product-images', () => ({
  convertProductImagesWorkflow: jest.fn(),
}));

const workflow = convertProductImagesWorkflow as unknown as jest.Mock;

function args(metadata?: Record<string, unknown>) {
  const options = resolveOptions({ apiKey: 'cvs_live_unit' }, {});
  const services: Record<string, unknown> = {
    cs: { isConfigured: () => true, getOptions: () => options },
    [ContainerRegistrationKeys.LOGGER]: { error: jest.fn() },
  };
  return {
    event: { name: 'product.updated', data: { id: 'prod_1' }, metadata },
    container: { resolve: (key: string) => services[key] },
  } as unknown as SubscriberArgs<{ id: string }>;
}

describe('the automatic conversion', () => {
  const runs: unknown[] = [];
  beforeEach(() => {
    runs.length = 0;
    workflow.mockImplementation(() => ({ run: async (input: unknown) => runs.push(input) }));
  });

  it("converts a product the store changed, as the plugin's own run", async () => {
    await convertProductImagesHandler(args({ eventGroupId: '01JABCDEF' }));
    await convertProductImagesHandler(args());
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      input: { product_id: 'prod_1', trigger: 'auto' },
      context: { eventGroupId: expect.stringMatching(/^converter-studio-/) },
    });
  });

  it("skips the update the plugin's own run made (a converted image put in place)", async () => {
    await convertProductImagesHandler(args(ownRunContext()));
    expect(runs).toHaveLength(0);
  });
});

describe('isOwnEvent', () => {
  it('knows the event groups of the plugin only', () => {
    expect(isOwnEvent(ownRunContext())).toBe(true);
    expect(ownRunContext().eventGroupId).not.toBe(ownRunContext().eventGroupId);
    expect(isOwnEvent({ eventGroupId: '01JABCDEF' })).toBe(false);
    expect(isOwnEvent({})).toBe(false);
    expect(isOwnEvent(undefined)).toBe(false);
  });
});
