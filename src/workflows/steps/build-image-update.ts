import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { buildImageUpdate } from '../../lib/plan';
import type { ConvertedImages } from './convert-images';
import { loadProduct } from './load-product';

export interface ImageUpdate {
  product_id: string;
  changed: boolean;
  images: { id: string; url: string; metadata?: Record<string, unknown> }[];
  thumbnail?: string;
  variants: { id: string; thumbnail: string }[];
  /** Records whose converted image was put in place. */
  applied: string[];
}

/**
 * Reads the product again, right before updating it, and builds the update that swaps in the
 * converted images: only images that still have the URL that was converted are changed, so
 * edits made while converting are kept.
 */
export const buildImageUpdateStep = createStep(
  'converter-studio-build-image-update',
  async (input: ConvertedImages, { container }) => {
    const product = await loadProduct(container, input.product_id);
    const none: ImageUpdate = {
      product_id: input.product_id,
      changed: false,
      images: [],
      variants: [],
      applied: [],
    };
    if (!product || !input.converted.length) return new StepResponse(none);
    const update = buildImageUpdate(
      product,
      input.converted.map((c) => ({
        record_id: c.record_id,
        image_id: c.image_id,
        target: c.target,
        source_url: c.url,
        result_url: c.result_url,
      })),
    );
    return new StepResponse<ImageUpdate>({
      product_id: input.product_id,
      changed: update.changed,
      images: update.images,
      ...(update.thumbnail ? { thumbnail: update.thumbnail } : {}),
      variants: update.variants,
      applied: [...update.applied],
    });
  },
);
