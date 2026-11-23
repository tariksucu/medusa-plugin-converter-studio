import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import type { ProductData } from '../../lib/plan';

/** A product's images, thumbnail and variant thumbnails as they are now (`null`: no product). */
export async function loadProduct(
  container: MedusaContainer,
  productId: string,
): Promise<ProductData | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'product',
    fields: [
      'id',
      'thumbnail',
      'images.id',
      'images.url',
      'images.rank',
      'images.metadata',
      'variants.id',
      'variants.thumbnail',
    ],
    filters: { id: productId },
  });
  const product = data[0] as
    | {
        id: string;
        thumbnail: string | null;
        images?:
          | {
              id: string;
              url: string;
              rank: number | null;
              metadata: Record<string, unknown> | null;
            }[]
          | null;
        variants?: { id: string; thumbnail?: string | null }[] | null;
      }
    | undefined;
  if (!product) return null;
  return {
    id: product.id,
    thumbnail: product.thumbnail ?? null,
    images: (product.images ?? []).filter(Boolean),
    variants: (product.variants ?? []).filter(Boolean),
  };
}
