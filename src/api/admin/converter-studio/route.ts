import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { asConverterStudioError, ERROR_TEXT } from '../../../lib/errors';
import { converterStudio } from '../../../lib/http';

/**
 * GET /admin/converter-studio: the plugin's options (without the key), the account's plan and
 * credits, and whether automatic conversions are paused.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = converterStudio(req.scope);
  let account = null;
  let accountError = null;
  if (service.isConfigured()) {
    try {
      account = await service.getAccount();
    } catch (thrown) {
      const error = asConverterStudioError(thrown);
      accountError = { code: error.code, message: ERROR_TEXT[error.code] };
    }
  }
  res.json({
    options: service.getPublicOptions(),
    account,
    account_error: accountError,
    pause: service.getPause(),
  });
}
