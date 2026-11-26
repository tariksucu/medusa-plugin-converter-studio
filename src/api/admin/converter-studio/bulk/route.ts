import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import { bulkProgress, cancelBulk, startBulk } from '../../../../lib/bulk';
import { converterStudio, readLimit } from '../../../../lib/http';

/** GET /admin/converter-studio/bulk: how far converting every product's images has come. */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.json({ bulk: bulkProgress() });
}

/**
 * POST /admin/converter-studio/bulk `{ action?: "start" | "cancel", limit?: number }`: starts
 * converting the images of every product (it stops by itself when the credits run out), or
 * cancels it. With `limit`, only that many images are tried: a sample, to see the savings and
 * the credits before converting the rest.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const action = (req.body as { action?: unknown } | undefined)?.action ?? 'start';
  if (action === 'cancel') {
    cancelBulk();
    return res.json({ bulk: bulkProgress() });
  }
  if (action !== 'start')
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'action must be "start" or "cancel"');
  const limit = readLimit(req.body);
  if (!converterStudio(req.scope).isConfigured())
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Set a Converter Studio API key in the plugin's options first",
    );
  startBulk(req.scope, limit);
  res.status(202).json({ bulk: bulkProgress() });
}
