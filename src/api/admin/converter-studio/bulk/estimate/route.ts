import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { estimateBulk } from '../../../../../lib/bulk';

/**
 * GET /admin/converter-studio/bulk/estimate: what "Convert all" would do now, before anything is
 * spent: the images it would send (one credit each, at most) and the ones it leaves alone.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({ estimate: await estimateBulk(req.scope) });
}
