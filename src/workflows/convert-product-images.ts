import {
  acquireLockStep,
  releaseLockStep,
  updateProductsWorkflow,
  updateProductVariantsWorkflow,
} from '@medusajs/medusa/core-flows';
import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
  type WorkflowData,
} from '@medusajs/framework/workflows-sdk';
import type { Trigger } from '../lib/plan';
import { buildImageUpdateStep } from './steps/build-image-update';
import { convertImagesStep } from './steps/convert-images';
import { finishConversionsStep } from './steps/finish-conversions';
import { prepareConversionsStep } from './steps/prepare-conversions';

export type ConvertProductImagesInput = {
  product_id: string;
  /** Only these images (all that need it when left out). */
  image_ids?: string[] | null;
  /** `auto` (a product was created or updated), `manual` (the admin) or `bulk`. */
  trigger: Trigger;
};

export const convertProductImagesWorkflowId = 'converter-studio-convert-product-images';

/**
 * Converts a product's images with Converter Studio and puts the results in place of the
 * originals (which stay in storage). One run at a time for a product.
 */
export const convertProductImagesWorkflow = createWorkflow(
  convertProductImagesWorkflowId,
  (input: WorkflowData<ConvertProductImagesInput>) => {
    const lockKey = transform(
      { input },
      ({ input }) => `converter-studio:product:${input.product_id}`,
    );
    acquireLockStep({ key: lockKey, timeout: 600, ttl: 900 });

    const prepared = prepareConversionsStep(input);
    const converted = convertImagesStep(prepared);
    const update = buildImageUpdateStep(converted);

    when({ update }, ({ update }) => update.changed).then(() => {
      const products = transform({ update }, ({ update }) => [
        {
          id: update.product_id,
          images: update.images,
          ...(update.thumbnail ? { thumbnail: update.thumbnail } : {}),
        },
      ]);
      updateProductsWorkflow.runAsStep({ input: { products } });
    });
    when({ update }, ({ update }) => update.variants.length > 0).then(() => {
      const productVariants = transform({ update }, ({ update }) => update.variants);
      updateProductVariantsWorkflow.runAsStep({ input: { product_variants: productVariants } });
    });

    const summary = finishConversionsStep({ converted, update });
    releaseLockStep({ key: lockKey });
    return new WorkflowResponse(summary);
  },
);
