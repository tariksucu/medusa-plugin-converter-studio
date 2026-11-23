import type { IFileModuleService, Logger } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { buildRestoreUpdate, planRestorations, type ConversionRecord } from '../../lib/plan';
import { CONVERTER_STUDIO_MODULE } from '../../modules/converter-studio';
import type ConverterStudioModuleService from '../../modules/converter-studio/service';
import { loadProduct } from './load-product';

export interface RestorePlan {
  product_id: string;
  changed: boolean;
  images: { id: string; url: string; metadata?: Record<string, unknown> }[];
  thumbnail?: string;
  variants: { id: string; thumbnail: string }[];
  record_ids: string[];
}

/** Finds the converted images of a product that still show their converted file. */
export const planRestoreStep = createStep(
  'converter-studio-plan-restore',
  async (input: { product_id: string; image_ids?: string[] | null }, { container }) => {
    const service: ConverterStudioModuleService = container.resolve(CONVERTER_STUDIO_MODULE);
    const none: RestorePlan = {
      product_id: input.product_id,
      changed: false,
      images: [],
      variants: [],
      record_ids: [],
    };
    const product = await loadProduct(container, input.product_id);
    if (!product) return new StepResponse(none);
    const records = (await service.listImageConversions(
      { product_id: input.product_id },
      { order: { created_at: 'DESC' }, take: 1000 },
    )) as unknown as ConversionRecord[];
    const restorations = planRestorations(product, records, input.image_ids);
    if (!restorations.length) return new StepResponse(none);
    const update = buildRestoreUpdate(product, restorations);
    return new StepResponse<RestorePlan>({
      product_id: input.product_id,
      changed: update.changed,
      images: update.images,
      ...(update.thumbnail ? { thumbnail: update.thumbnail } : {}),
      variants: update.variants,
      record_ids: restorations.map((r) => r.record_id),
    });
  },
);

/** Marks the records as restored and deletes the converted files nobody uses now. */
export const finishRestoreStep = createStep(
  'converter-studio-finish-restore',
  async (input: RestorePlan, { container }) => {
    if (!input.record_ids.length)
      return new StepResponse({ product_id: input.product_id, restored: 0 });
    const service: ConverterStudioModuleService = container.resolve(CONVERTER_STUDIO_MODULE);
    const files: IFileModuleService = container.resolve(Modules.FILE);
    const logger: Logger = container.resolve(ContainerRegistrationKeys.LOGGER);
    const rows = await service.listImageConversions({ id: input.record_ids });
    await service.updateImageConversions(
      rows.map((row) => ({ id: row.id, status: 'restored' as const, reason: null, message: null })),
    );
    const fileIds = rows.map((row) => row.result_file_id).filter((id): id is string => Boolean(id));
    if (fileIds.length)
      await files
        .deleteFiles(fileIds)
        .catch((error: unknown) =>
          logger.warn(`Converter Studio: could not delete converted files: ${String(error)}`),
        );
    return new StepResponse({ product_id: input.product_id, restored: rows.length });
  },
);
