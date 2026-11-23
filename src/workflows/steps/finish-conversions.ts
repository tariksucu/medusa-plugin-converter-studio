import type { IFileModuleService, Logger } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { ERROR_TEXT, type ErrorCode } from '../../lib/errors';
import { CONVERTER_STUDIO_MODULE } from '../../modules/converter-studio';
import type ConverterStudioModuleService from '../../modules/converter-studio/service';
import type { ImageUpdate } from './build-image-update';
import type { ConvertedImages } from './convert-images';

export interface ConversionSummary {
  product_id: string;
  converted: number;
  skipped: number;
  failed: number;
  /** Credits the conversions cost (kept originals included). */
  credits: number;
  /** Bytes saved by the images put in place. */
  saved_bytes: number;
  stopped_by: ErrorCode | null;
}

/** Writes down what became of each image, and removes converted files that were not used. */
export const finishConversionsStep = createStep(
  'converter-studio-finish-conversions',
  async (input: { converted: ConvertedImages; update: ImageUpdate }, { container }) => {
    const service: ConverterStudioModuleService = container.resolve(CONVERTER_STUDIO_MODULE);
    const files: IFileModuleService = container.resolve(Modules.FILE);
    const logger: Logger = container.resolve(ContainerRegistrationKeys.LOGGER);
    const { converted, update } = input;
    const applied = new Set(update.applied);
    const unused = converted.converted.filter((c) => !applied.has(c.record_id));

    const rows = [
      ...converted.converted.map((c) =>
        applied.has(c.record_id)
          ? {
              id: c.record_id,
              status: 'converted' as const,
              reason: null,
              message: null,
              result_url: c.result_url,
              result_file_id: c.result_file_id,
              from_format: c.from_format,
              to_format: c.to_format,
              credits: c.credits,
              source_size: c.source_size,
              result_size: c.result_size,
              conversion_id: c.conversion_id,
            }
          : {
              id: c.record_id,
              status: 'skipped' as const,
              reason: 'imageChanged',
              message: ERROR_TEXT.imageChanged,
              from_format: c.from_format,
              to_format: c.to_format,
              credits: c.credits,
              source_size: c.source_size,
              result_size: c.result_size,
              conversion_id: c.conversion_id,
            },
      ),
      ...converted.skipped.map((s) => ({
        id: s.record_id,
        status: 'skipped' as const,
        reason: s.reason,
        message: ERROR_TEXT[s.reason],
        from_format: s.from_format,
        credits: s.credits,
        source_size: s.source_size,
        result_size: s.result_size,
        conversion_id: s.conversion_id,
      })),
      ...converted.failed.map((f) => ({
        id: f.record_id,
        status: 'failed' as const,
        reason: f.reason,
        message: f.message,
      })),
    ];
    if (rows.length) await service.updateImageConversions(rows);
    if (unused.length)
      await files
        .deleteFiles(unused.map((c) => c.result_file_id))
        .catch((error: unknown) =>
          logger.warn(
            `Converter Studio: could not delete unused converted files: ${String(error)}`,
          ),
        );

    const used = converted.converted.filter((c) => applied.has(c.record_id));
    const summary: ConversionSummary = {
      product_id: converted.product_id,
      converted: used.length,
      skipped: converted.skipped.length + unused.length,
      failed: converted.failed.length,
      credits: [...converted.converted, ...converted.skipped].reduce(
        (sum, c) => sum + (c.credits ?? 0),
        0,
      ),
      saved_bytes: used.reduce((sum, c) => sum + Math.max(0, c.source_size - c.result_size), 0),
      stopped_by: converted.stopped_by,
    };
    if (summary.converted)
      logger.info(
        `Converter Studio: converted ${summary.converted} image(s) of product ${summary.product_id} (${summary.credits} credit(s)).`,
      );
    return new StepResponse(summary);
  },
);
