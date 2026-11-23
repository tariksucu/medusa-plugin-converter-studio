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
import { finishRestoreStep, planRestoreStep } from './steps/restore-steps';

export type RestoreProductImagesInput = {
  product_id: string;
  /** Only these images (all converted ones when left out). */
  image_ids?: string[] | null;
};

export const restoreProductImagesWorkflowId = 'converter-studio-restore-product-images';

/**
 * Puts a product's original images back in place of the converted ones. Automatic conversions
 * leave restored images alone afterwards.
 */
export const restoreProductImagesWorkflow = createWorkflow(
  restoreProductImagesWorkflowId,
  (input: WorkflowData<RestoreProductImagesInput>) => {
    const lockKey = transform(
      { input },
      ({ input }) => `converter-studio:product:${input.product_id}`,
    );
    acquireLockStep({ key: lockKey, timeout: 60, ttl: 120 });

    const plan = planRestoreStep(input);
    when({ plan }, ({ plan }) => plan.changed).then(() => {
      const products = transform({ plan }, ({ plan }) => [
        {
          id: plan.product_id,
          images: plan.images,
          ...(plan.thumbnail ? { thumbnail: plan.thumbnail } : {}),
        },
      ]);
      updateProductsWorkflow.runAsStep({ input: { products } });
    });
    when({ plan }, ({ plan }) => plan.variants.length > 0).then(() => {
      const productVariants = transform({ plan }, ({ plan }) => plan.variants);
      updateProductVariantsWorkflow.runAsStep({ input: { product_variants: productVariants } });
    });
    const result = finishRestoreStep(plan);
    releaseLockStep({ key: lockKey });
    return new WorkflowResponse(result);
  },
);
