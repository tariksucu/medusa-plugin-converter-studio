import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import type { ErrorCode } from '../../lib/errors';
import { planConversions, type ConversionRecord, type Trigger } from '../../lib/plan';
import { CONVERTER_STUDIO_MODULE } from '../../modules/converter-studio';
import type ConverterStudioModuleService from '../../modules/converter-studio/service';
import { loadProduct } from './load-product';

export interface PrepareConversionsInput {
  product_id: string;
  image_ids?: string[] | null;
  trigger: Trigger;
}

export interface PreparedCandidate {
  record_id: string;
  image_id: string | null;
  target: 'image' | 'thumbnail';
  url: string;
  download_url: string;
}

export interface PreparedConversions {
  product_id: string;
  trigger: Trigger;
  candidates: PreparedCandidate[];
  /** Why nothing was tried, when nothing was: no key, or automatic runs paused. */
  blocked: ErrorCode | null;
}

/**
 * Picks the product's images to convert (by the rules in `lib/plan`) and marks each as
 * "processing", so a second run or the admin can see it.
 */
export const prepareConversionsStep = createStep(
  'converter-studio-prepare-conversions',
  async (input: PrepareConversionsInput, { container }) => {
    const service: ConverterStudioModuleService = container.resolve(CONVERTER_STUDIO_MODULE);
    const empty = (blocked: ErrorCode | null) =>
      new StepResponse<PreparedConversions, string[]>(
        { product_id: input.product_id, trigger: input.trigger, candidates: [], blocked },
        [],
      );
    if (!service.isConfigured()) return empty('notConfigured');
    const pause = service.getPause();
    if (pause && input.trigger === 'auto') return empty(pause.code);

    const product = await loadProduct(container, input.product_id);
    if (!product) return empty(null);
    const records = (await service.listImageConversions(
      { product_id: input.product_id },
      { order: { created_at: 'DESC' }, take: 1000 },
    )) as unknown as ConversionRecord[];
    const options = service.getOptions();
    const planned = planConversions({
      product,
      records,
      options,
      trigger: input.trigger,
      imageIds: input.image_ids,
    });
    if (!planned.length) return empty(null);

    const created = await service.createImageConversions(
      planned.map((c) => ({
        product_id: input.product_id,
        image_id: c.image_id,
        target: c.target,
        source_url: c.url,
        to_format: options.format,
        status: 'processing' as const,
        trigger: input.trigger,
      })),
    );
    const candidates = planned.map((c, i) => ({ ...c, record_id: created[i]!.id }));
    return new StepResponse<PreparedConversions, string[]>(
      { product_id: input.product_id, trigger: input.trigger, candidates, blocked: null },
      candidates.map((c) => c.record_id),
    );
  },
  async (recordIds, { container }) => {
    if (!recordIds?.length) return;
    const service: ConverterStudioModuleService = container.resolve(CONVERTER_STUDIO_MODULE);
    // The run failed after this step: rows still "processing" are left as failed.
    const rows = await service.listImageConversions(
      { id: recordIds, status: 'processing' },
      { select: ['id'] },
    );
    if (rows.length)
      await service.updateImageConversions(
        rows.map((row) => ({
          id: row.id,
          status: 'failed' as const,
          reason: 'unknown',
          message: 'The run stopped before the image was put in place.',
        })),
      );
  },
);
