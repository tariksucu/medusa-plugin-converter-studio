import type { MedusaContainer } from '@medusajs/framework/types';
import { MedusaError } from '@medusajs/framework/utils';
import { CONVERTER_STUDIO_MODULE } from '../modules/converter-studio';
import type ConverterStudioModuleService from '../modules/converter-studio/service';
import type { ConversionRecord } from './plan';

export const converterStudio = (scope: MedusaContainer): ConverterStudioModuleService =>
  scope.resolve(CONVERTER_STUDIO_MODULE);

/** `{ image_ids?: string[] }` from a request body, checked. */
export function readImageIds(body: unknown): string[] | null {
  if (body === undefined || body === null || typeof body !== 'object') return null;
  const ids = (body as { image_ids?: unknown }).image_ids;
  if (ids === undefined || ids === null) return null;
  if (
    !Array.isArray(ids) ||
    ids.length > 500 ||
    !ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 100)
  )
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'image_ids must be a list of product image ids',
    );
  return ids as string[];
}

/** The most images a sample run (`{ limit }`) may try. */
export const MAX_SAMPLE = 1000;

/** `{ limit?: number }` from a bulk request's body, checked: `null` for every image. */
export function readLimit(body: unknown): number | null {
  if (body === undefined || body === null || typeof body !== 'object') return null;
  const limit = (body as { limit?: unknown }).limit;
  if (limit === undefined || limit === null) return null;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_SAMPLE)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `limit must be a whole number from 1 to ${MAX_SAMPLE}`,
    );
  return limit;
}

/** The records of a product, newest first. */
export async function productRecords(service: ConverterStudioModuleService, productId: string) {
  return (await service.listImageConversions(
    { product_id: productId },
    { order: { created_at: 'DESC' }, take: 1000 },
  )) as unknown as ConversionRecord[];
}
