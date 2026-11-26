import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework';
import type { Logger } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { endRun, isOwnEvent, ownRunContext, startRun } from '../lib/runs';
import { CONVERTER_STUDIO_MODULE } from '../modules/converter-studio';
import type ConverterStudioModuleService from '../modules/converter-studio/service';
import { convertProductImagesWorkflow } from '../workflows/convert-product-images';

/**
 * When a product is created or updated, converts its new images in the background (unless the
 * plugin's `autoConvert` option is off). The product is saved first, with the originals; the
 * converted images take their place a few seconds later. The plugin's own updates are skipped.
 */
export default async function convertProductImagesHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const service: ConverterStudioModuleService = container.resolve(CONVERTER_STUDIO_MODULE);
  if (!service.isConfigured() || !service.getOptions().autoConvert) return;
  const productId = event.data?.id;
  if (typeof productId !== 'string') return;
  // The plugin's own update (a converted or restored image put in place) is not a change to
  // convert for.
  if (isOwnEvent(event.metadata)) return;
  const logger: Logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  startRun(productId);
  try {
    await convertProductImagesWorkflow(container).run({
      input: { product_id: productId, trigger: 'auto' },
      context: ownRunContext(),
    });
  } catch (error) {
    logger.error(
      `Converter Studio: converting the images of product ${productId} failed: ${String(error)}`,
    );
  } finally {
    endRun(productId);
  }
}

export const config: SubscriberConfig = {
  event: ['product.created', 'product.updated'],
  context: { subscriberId: 'converter-studio-convert-product-images' },
};
