import type { Logger, MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { CONVERTER_STUDIO_MODULE } from '../modules/converter-studio';
import type ConverterStudioModuleService from '../modules/converter-studio/service';
import { convertProductImagesWorkflow } from '../workflows/convert-product-images';
import { errorKind, type ErrorCode } from './errors';
import {
  estimateProduct,
  planConversions,
  type ConversionRecord,
  type ImageEstimate,
  type ProductData,
} from './plan';
import { endRun, ownRunContext, startRun } from './runs';

/**
 * Converting the images of every product, one product after another, in the background of
 * this process. It stops by itself when the credits run out or the key fails. With a `limit`,
 * it tries only that many images (a sample, to see the savings before spending more).
 */
export interface BulkProgress {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  /** The most images this run tries (a sample), or `null` for all. */
  limit: number | null;
  products_total: number;
  products_done: number;
  /** Images tried: converted, kept as they were, or not converted. */
  images_done: number;
  converted: number;
  skipped: number;
  failed: number;
  credits: number;
  /** Of `credits`, the ones spent on images whose original was kept (a larger result). */
  credits_kept: number;
  saved_bytes: number;
  stopped_by: ErrorCode | 'canceled' | null;
}

/** What a bulk run would do now, before anything is spent. */
export interface BulkEstimate extends ImageEstimate {
  products: number;
  /** Products with at least one image to send. */
  products_to_convert: number;
  /** The most credits it can cost: one an image (failed conversions cost nothing). */
  credits: number;
}

const PAGE = 50;

const fresh = (limit: number | null): BulkProgress => ({
  running: false,
  started_at: null,
  finished_at: null,
  limit,
  products_total: 0,
  products_done: 0,
  images_done: 0,
  converted: 0,
  skipped: 0,
  failed: 0,
  credits: 0,
  credits_kept: 0,
  saved_bytes: 0,
  stopped_by: null,
});

let progress: BulkProgress = fresh(null);
let cancelRequested = false;

export const bulkProgress = (): BulkProgress => ({ ...progress });

export function cancelBulk(): boolean {
  if (!progress.running) return false;
  cancelRequested = true;
  return true;
}

/**
 * Starts a bulk run unless one is running; `false` when one already is. `limit`: try only this
 * many images (the first ones that need converting, product by product).
 */
export function startBulk(container: MedusaContainer, limit: number | null = null): boolean {
  if (progress.running) return false;
  cancelRequested = false;
  progress = { ...fresh(limit), running: true, started_at: new Date().toISOString() };
  void run(container, limit);
  return true;
}

/** The test hook: waits for the run `startBulk` started. */
let current: Promise<void> = Promise.resolve();
export const bulkDone = (): Promise<void> => current;

/** A page of products with their images, oldest first. */
async function productPage(
  container: MedusaContainer,
  skip: number,
): Promise<{ products: ProductData[]; count: number | undefined }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data, metadata } = await query.graph({
    entity: 'product',
    fields: ['id', 'thumbnail', 'images.id', 'images.url', 'images.rank', 'images.metadata'],
    pagination: { skip, take: PAGE, order: { created_at: 'ASC' } },
  });
  const products = (
    data as {
      id: string;
      thumbnail?: string | null;
      images?: ProductData['images'] | null;
    }[]
  ).map((p) => ({
    id: p.id,
    thumbnail: p.thumbnail ?? null,
    images: (p.images ?? []).filter(Boolean),
  }));
  return { products, count: metadata?.count };
}

/** The conversion records of some products, by product. */
async function recordsOf(
  service: ConverterStudioModuleService,
  productIds: string[],
): Promise<Map<string, ConversionRecord[]>> {
  const byProduct = new Map<string, ConversionRecord[]>();
  if (!productIds.length) return byProduct;
  const rows = (await service.listImageConversions(
    { product_id: productIds },
    { order: { created_at: 'DESC' } },
  )) as unknown as (ConversionRecord & { product_id: string })[];
  for (const row of rows) {
    const list = byProduct.get(row.product_id) ?? [];
    list.push(row);
    byProduct.set(row.product_id, list);
  }
  return byProduct;
}

/**
 * Counts what "Convert all" would do now: the images it would send to Converter Studio (one
 * credit each, at most) and the ones it leaves alone for free. Reads the catalog, spends nothing.
 */
export async function estimateBulk(container: MedusaContainer): Promise<BulkEstimate> {
  const service: ConverterStudioModuleService = container.resolve(CONVERTER_STUDIO_MODULE);
  const options = service.getOptions();
  const estimate: BulkEstimate = {
    products: 0,
    products_to_convert: 0,
    convert: 0,
    already_target: 0,
    left: 0,
    credits: 0,
  };
  const now = Date.now();
  for (let skip = 0; ; skip += PAGE) {
    const { products } = await productPage(container, skip);
    if (!products.length) break;
    const records = await recordsOf(
      service,
      products.map((p) => p.id),
    );
    for (const product of products) {
      const counts = estimateProduct(product, records.get(product.id) ?? [], options, now);
      estimate.products += 1;
      if (counts.convert) estimate.products_to_convert += 1;
      estimate.convert += counts.convert;
      estimate.already_target += counts.already_target;
      estimate.left += counts.left;
    }
    if (products.length < PAGE) break;
  }
  estimate.credits = estimate.convert;
  return estimate;
}

function run(container: MedusaContainer, limit: number | null): Promise<void> {
  current = work(container, limit);
  return current;
}

async function work(container: MedusaContainer, limit: number | null): Promise<void> {
  const logger: Logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const service: ConverterStudioModuleService = container.resolve(CONVERTER_STUDIO_MODULE);
  try {
    pages: for (let skip = 0; ; skip += PAGE) {
      const { products, count } = await productPage(container, skip);
      progress.products_total = count ?? progress.products_total;
      if (!products.length) break;
      const records =
        limit === null
          ? null
          : await recordsOf(
              service,
              products.map((p) => p.id),
            );
      for (const product of products) {
        if (cancelRequested) {
          progress.stopped_by = 'canceled';
          return;
        }
        if (limit !== null && progress.images_done >= limit) break pages;
        // A sample takes only as many of the product's images as it has left to try.
        let imageIds: string[] | null = null;
        if (limit !== null) {
          imageIds = planConversions({
            product,
            records: records?.get(product.id) ?? [],
            options: service.getOptions(),
            trigger: 'bulk',
          })
            .flatMap((c) => (c.image_id ? [c.image_id] : []))
            .slice(0, limit - progress.images_done);
          if (!imageIds.length) {
            progress.products_done += 1;
            continue;
          }
        }
        startRun(product.id);
        try {
          const { result } = await convertProductImagesWorkflow(container).run({
            input: { product_id: product.id, trigger: 'bulk', image_ids: imageIds },
            context: ownRunContext(),
          });
          progress.converted += result.converted;
          progress.skipped += result.skipped;
          progress.failed += result.failed;
          progress.images_done += result.converted + result.skipped + result.failed;
          progress.credits += result.credits;
          progress.credits_kept += result.credits_kept ?? 0;
          progress.saved_bytes += result.saved_bytes;
          if (result.stopped_by && ['credits', 'auth'].includes(errorKind(result.stopped_by))) {
            progress.stopped_by = result.stopped_by;
            return;
          }
        } catch (error) {
          progress.failed += 1;
          progress.images_done += imageIds?.length ?? 1;
          logger.error(
            `Converter Studio: bulk conversion of product ${product.id} failed: ${String(error)}`,
          );
        } finally {
          endRun(product.id);
          progress.products_done += 1;
        }
      }
      if (products.length < PAGE) break;
    }
  } catch (error) {
    logger.error(`Converter Studio: the bulk conversion stopped: ${String(error)}`);
    progress.stopped_by = 'unknown';
  } finally {
    progress.running = false;
    progress.finished_at = new Date().toISOString();
    logger.info(
      `Converter Studio: bulk conversion ${limit === null ? '' : `of a sample of ${limit} image(s) `}finished: ${progress.converted} converted, ${progress.skipped} kept as they were, ${progress.failed} failed, ${progress.credits} credit(s).`,
    );
  }
}
