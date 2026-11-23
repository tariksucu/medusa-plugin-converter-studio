import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import type { Logger } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { converterStudio, readImageIds } from '../../../../../../lib/http';
import { endRun, isRunning, startRun } from '../../../../../../lib/runs';
import { convertProductImagesWorkflow } from '../../../../../../workflows/convert-product-images';
import { loadProduct } from '../../../../../../workflows/steps/load-product';

/**
 * POST /admin/converter-studio/products/:id/convert `{ image_ids?: string[] }`: converts the
 * product's images that need it (failed and restored ones included) in the background; the
 * admin follows along with GET /admin/converter-studio/products/:id. Answers 202.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = converterStudio(req.scope);
  if (!service.isConfigured())
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Set a Converter Studio API key in the plugin's options first",
    );
  const imageIds = readImageIds(req.body);
  const productId = req.params.id!;
  if (!(await loadProduct(req.scope, productId)))
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${productId} was not found`);
  if (isRunning(productId))
    return res.status(202).json({ product_id: productId, started: false, running: true });

  const logger: Logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const container = req.scope;
  startRun(productId);
  void convertProductImagesWorkflow(container)
    .run({ input: { product_id: productId, image_ids: imageIds, trigger: 'manual' } })
    .catch((error: unknown) =>
      logger.error(
        `Converter Studio: converting the images of product ${productId} failed: ${String(error)}`,
      ),
    )
    .finally(() => endRun(productId));
  res.status(202).json({ product_id: productId, started: true, running: true });
}
