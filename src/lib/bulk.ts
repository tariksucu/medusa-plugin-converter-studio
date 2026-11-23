import type { Logger, MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { convertProductImagesWorkflow } from '../workflows/convert-product-images';
import { errorKind, type ErrorCode } from './errors';
import { endRun, startRun } from './runs';

/**
 * Converting the images of every product, one product after another, in the background of
 * this process. It stops by itself when the credits run out or the key fails.
 */
export interface BulkProgress {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  products_total: number;
  products_done: number;
  converted: number;
  skipped: number;
  failed: number;
  credits: number;
  saved_bytes: number;
  stopped_by: ErrorCode | 'canceled' | null;
}

const PAGE = 50;

let progress: BulkProgress = {
  running: false,
  started_at: null,
  finished_at: null,
  products_total: 0,
  products_done: 0,
  converted: 0,
  skipped: 0,
  failed: 0,
  credits: 0,
  saved_bytes: 0,
  stopped_by: null,
};
let cancelRequested = false;

export const bulkProgress = (): BulkProgress => ({ ...progress });

export function cancelBulk(): boolean {
  if (!progress.running) return false;
  cancelRequested = true;
  return true;
}

/** Starts a bulk run unless one is running; `false` when one already is. */
export function startBulk(container: MedusaContainer): boolean {
  if (progress.running) return false;
  cancelRequested = false;
  progress = {
    running: true,
    started_at: new Date().toISOString(),
    finished_at: null,
    products_total: 0,
    products_done: 0,
    converted: 0,
    skipped: 0,
    failed: 0,
    credits: 0,
    saved_bytes: 0,
    stopped_by: null,
  };
  void run(container);
  return true;
}

async function run(container: MedusaContainer): Promise<void> {
  const logger: Logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  try {
    for (let skip = 0; ; skip += PAGE) {
      const { data, metadata } = await query.graph({
        entity: 'product',
        fields: ['id'],
        pagination: { skip, take: PAGE, order: { created_at: 'ASC' } },
      });
      progress.products_total = metadata?.count ?? progress.products_total;
      if (!data.length) break;
      for (const { id } of data as { id: string }[]) {
        if (cancelRequested) {
          progress.stopped_by = 'canceled';
          return;
        }
        startRun(id);
        try {
          const { result } = await convertProductImagesWorkflow(container).run({
            input: { product_id: id, trigger: 'bulk' },
          });
          progress.converted += result.converted;
          progress.skipped += result.skipped;
          progress.failed += result.failed;
          progress.credits += result.credits;
          progress.saved_bytes += result.saved_bytes;
          if (result.stopped_by && ['credits', 'auth'].includes(errorKind(result.stopped_by))) {
            progress.stopped_by = result.stopped_by;
            return;
          }
        } catch (error) {
          progress.failed += 1;
          logger.error(
            `Converter Studio: bulk conversion of product ${id} failed: ${String(error)}`,
          );
        } finally {
          endRun(id);
          progress.products_done += 1;
        }
      }
      if (data.length < PAGE) break;
    }
  } catch (error) {
    logger.error(`Converter Studio: the bulk conversion stopped: ${String(error)}`);
    progress.stopped_by = 'unknown';
  } finally {
    progress.running = false;
    progress.finished_at = new Date().toISOString();
    logger.info(
      `Converter Studio: bulk conversion finished: ${progress.converted} converted, ${progress.failed} failed, ${progress.credits} credit(s).`,
    );
  }
}
