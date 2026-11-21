import { handler, ok, assertMethod } from './_lib/http.js';
import { serviceClient } from './_lib/supabase.js';
import { env } from './_lib/env.js';
import { paymentProviderStatus } from '../integrations/payments/registry.js';

/**
 * Operational health check. Reports capability booleans only — never keys,
 * URLs or error internals.
 */
export default handler(async (req, res) => {
  assertMethod(req, ['GET']);

  const checks = {
    environment: {
      supabase: Boolean(env('SUPABASE_URL') && env('SUPABASE_SERVICE_ROLE_KEY')),
      site_url: Boolean(env('PUBLIC_SITE_URL') || env('VITE_STORE_URL')),
      cron_secret: Boolean(env('CRON_SECRET')),
      rate_limit_salt: Boolean(env('RATE_LIMIT_SALT'))
    },
    database: 'unknown',
    payments: paymentProviderStatus(),
    email: {
      provider: env('EMAIL_PROVIDER', 'log'),
      configured:
        env('EMAIL_PROVIDER', 'log') === 'log'
          ? true
          : Boolean(env('RESEND_API_KEY') && env('EMAIL_FROM'))
    },
    supplier: {
      token_configured: Boolean(env('AW_DROPSHIP_API_TOKEN')),
      order_submission_enabled: env('AW_DROPSHIP_ORDER_SUBMISSION_ENABLED', 'false') === 'true'
    }
  };

  try {
    const { error } = await serviceClient()
      .from('store_settings')
      .select('key', { head: true, count: 'exact' })
      .limit(1);
    checks.database = error ? 'error' : 'ok';
  } catch {
    checks.database = 'error';
  }

  const healthy =
    checks.database === 'ok' &&
    checks.environment.supabase &&
    checks.payments.available &&
    checks.environment.cron_secret;

  return ok(res, { status: healthy ? 'ok' : 'degraded', checks });
});
