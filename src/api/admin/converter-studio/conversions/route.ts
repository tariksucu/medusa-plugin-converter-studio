import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { converterStudio } from '../../../../lib/http';

/**
 * GET /admin/converter-studio/conversions?limit=&offset=&status=: the latest image conversions
 * of the store, newest first.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = converterStudio(req.scope);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const allowed = ['processing', 'converted', 'skipped', 'failed', 'restored'] as const;
  const filters =
    status && (allowed as readonly string[]).includes(status)
      ? { status: status as (typeof allowed)[number] }
      : {};
  const [conversions, count] = await service.listAndCountImageConversions(filters, {
    order: { created_at: 'DESC' },
    skip: offset,
    take: limit,
  });
  res.json({ conversions, count, limit, offset });
}
