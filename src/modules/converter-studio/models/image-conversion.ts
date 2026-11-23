import { model } from '@medusajs/framework/utils';

/**
 * One try at converting one product image (or a product's own thumbnail): what it was, what it
 * became, and why not when it did not. The newest row for an image and URL is its state.
 */
const ImageConversion = model
  .define('converter_studio_image_conversion', {
    id: model.id({ prefix: 'csic' }).primaryKey(),
    product_id: model.text(),
    /** The product image; `null` for a thumbnail that is not one of the product's images. */
    image_id: model.text().nullable(),
    target: model.enum(['image', 'thumbnail']).default('image'),
    source_url: model.text(),
    result_url: model.text().nullable(),
    /** The converted file's id in the File Module (to delete it again). */
    result_file_id: model.text().nullable(),
    from_format: model.text().nullable(),
    to_format: model.text(),
    status: model.enum(['processing', 'converted', 'skipped', 'failed', 'restored']),
    /** An error code or a skip reason, from the plugin's fixed lists. */
    reason: model.text().nullable(),
    message: model.text().nullable(),
    credits: model.number().nullable(),
    source_size: model.number().nullable(),
    result_size: model.number().nullable(),
    /** Converter Studio's conversion id. */
    conversion_id: model.text().nullable(),
    trigger: model.enum(['auto', 'manual', 'bulk']),
  })
  .indexes([
    { name: 'IDX_cs_image_conversion_product_id', on: ['product_id'] },
    { name: 'IDX_cs_image_conversion_status', on: ['status'] },
  ]);

export default ImageConversion;
