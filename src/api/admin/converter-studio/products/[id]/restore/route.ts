import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import { readImageIds } from '../../../../../../lib/http';
import { isRunning } from '../../../../../../lib/runs';
import { restoreProductImagesWorkflow } from '../../../../../../workflows/restore-product-images';
import { loadProduct } from '../../../../../../workflows/steps/load-product';

/**
 * POST /admin/converter-studio/products/:id/restore `{ image_ids?: string[] }`: puts the
 * original images back in place of the converted ones (no credits are involved).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const imageIds = readImageIds(req.body);
  const productId = req.params.id!;
  if (!(await loadProduct(req.scope, productId)))
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${productId} was not found`);
  if (isRunning(productId))
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "The product's images are being converted; try again when it is done",
    );
  const { result } = await restoreProductImagesWorkflow(req.scope).run({
    input: { product_id: productId, image_ids: imageIds },
  });
  res.json(result);
}
