import type { IFileModuleService, Logger } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { randomBytes } from 'node:crypto';
import { mapLimit } from '../../lib/convert-image';
import {
  asConverterStudioError,
  ConverterStudioError,
  ERROR_TEXT,
  type ErrorCode,
  type SkipReason,
} from '../../lib/errors';
import { convertedFileName, mimeType } from '../../lib/formats';
import { CONVERTER_STUDIO_MODULE } from '../../modules/converter-studio';
import type ConverterStudioModuleService from '../../modules/converter-studio/service';
import type { PreparedCandidate, PreparedConversions } from './prepare-conversions';

export interface ConvertedImage extends PreparedCandidate {
  result_url: string;
  result_file_id: string;
  from_format: string;
  to_format: string;
  credits: number | null;
  source_size: number;
  result_size: number;
  conversion_id: string;
}

export interface SkippedImage extends PreparedCandidate {
  reason: SkipReason;
  from_format: string | null;
  credits: number | null;
  source_size: number;
  result_size: number | null;
  conversion_id: string | null;
}

export interface FailedImage extends PreparedCandidate {
  reason: ErrorCode;
  message: string;
}

export interface ConvertedImages {
  product_id: string;
  converted: ConvertedImage[];
  skipped: SkippedImage[];
  failed: FailedImage[];
  /** The run stopped early for this (out of credits, a key that does not work). */
  stopped_by: ErrorCode | null;
}

/** Converts from the first original when there is one, else (or when it is gone) the image. */
async function convertFrom(service: ConverterStudioModuleService, candidate: PreparedCandidate) {
  if (candidate.download_url === candidate.url) return service.convertImageUrl(candidate.url);
  try {
    return await service.convertImageUrl(candidate.download_url);
  } catch (error) {
    if (error instanceof ConverterStudioError && error.code === 'sourceDownloadFailed')
      return service.convertImageUrl(candidate.url);
    throw error;
  }
}

/**
 * Converts the images with Converter Studio and saves each result with the store's File Module
 * provider (S3, local…). Running out of credits or a failing key stops the run: the images not
 * tried yet keep their originals and are marked with that reason.
 */
export const convertImagesStep = createStep(
  'converter-studio-convert-images',
  async (input: PreparedConversions, { container }) => {
    const service: ConverterStudioModuleService = container.resolve(CONVERTER_STUDIO_MODULE);
    const files: IFileModuleService = container.resolve(Modules.FILE);
    const logger: Logger = container.resolve(ContainerRegistrationKeys.LOGGER);
    const options = service.getOptions();
    const result: ConvertedImages = {
      product_id: input.product_id,
      converted: [],
      skipped: [],
      failed: [],
      stopped_by: null,
    };

    const outcomes = await mapLimit(
      input.candidates,
      options.concurrency,
      async (candidate, stop) => {
        try {
          const outcome = await convertFrom(service, candidate);
          if (outcome.status === 'skipped') {
            result.skipped.push({
              ...candidate,
              reason: outcome.reason,
              from_format: outcome.from,
              credits: outcome.credits,
              source_size: outcome.sourceSize,
              result_size: outcome.resultSize,
              conversion_id: outcome.conversionId,
            });
            return true;
          }
          let stored: { id: string; url: string };
          try {
            stored = await files.createFiles({
              filename: convertedFileName(
                candidate.url,
                outcome.to,
                randomBytes(4).toString('hex'),
              ),
              mimeType: mimeType(outcome.to),
              content: Buffer.from(outcome.bytes).toString('base64'),
              access: 'public',
            });
          } catch (cause) {
            throw new ConverterStudioError('storageFailed', ERROR_TEXT.storageFailed, { cause });
          }
          result.converted.push({
            ...candidate,
            result_url: stored.url,
            result_file_id: stored.id,
            from_format: outcome.from,
            to_format: outcome.to,
            credits: outcome.credits,
            source_size: outcome.sourceSize,
            result_size: outcome.resultSize,
            conversion_id: outcome.conversionId,
          });
          return true;
        } catch (thrown) {
          const error = asConverterStudioError(thrown);
          result.failed.push({
            ...candidate,
            reason: error.code,
            message: error.message.slice(0, 500),
          });
          if (error.kind === 'credits' || error.kind === 'auth') {
            service.notePause(error.code);
            if (!result.stopped_by) result.stopped_by = error.code;
            stop();
          } else {
            logger.warn(
              `Converter Studio: ${candidate.url} was not converted: ${error.message} (${error.code})`,
            );
          }
          return true;
        }
      },
    );
    // Images not tried because the run stopped keep their originals, for the same reason.
    input.candidates.forEach((candidate, i) => {
      if (outcomes[i] === undefined && result.stopped_by)
        result.failed.push({
          ...candidate,
          reason: result.stopped_by,
          message: ERROR_TEXT[result.stopped_by],
        });
    });
    if (result.converted.length) service.clearPause();
    return new StepResponse(
      result,
      result.converted.map((c) => c.result_file_id),
    );
  },
  async (fileIds, { container }) => {
    if (!fileIds?.length) return;
    const files: IFileModuleService = container.resolve(Modules.FILE);
    await files.deleteFiles(fileIds);
  },
);
