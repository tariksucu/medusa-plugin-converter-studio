import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import { converterStudio, productRecords } from '../../../../../lib/http';
import { isRunning } from '../../../../../lib/runs';
import { productImageStatus, summarize } from '../../../../../lib/status';
import { loadProduct } from '../../../../../workflows/steps/load-product';

/** GET /admin/converter-studio/products/:id: the state of each of the product's images. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = converterStudio(req.scope);
  const product = await loadProduct(req.scope, req.params.id!);
  if (!product)
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${req.params.id} was not found`);
  const images = productImageStatus(
    product,
    await productRecords(service, product.id),
    service.getOptions(),
  );
  const summary = summarize(images);
  res.json({
    product_id: product.id,
    options: service.getPublicOptions(),
    pause: service.getPause(),
    running: isRunning(product.id) || summary.processing > 0,
    summary,
    images,
  });
}
