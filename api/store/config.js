import { handler, ok, assertMethod } from '../_lib/http.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import {
  loadShippingSettings,
  shippingRegions,
  shippingNote,
  storeCurrency
} from '../_lib/shipping.js';
import { getPaymentProvider, paymentProviderStatus } from '../../integrations/payments/registry.js';

/**
 * Public storefront configuration. This is the only place the browser learns
 * which payment provider is active; secrets and provider details never leave
 * the server.
 */
export default handler(async (req, res) => {
  assertMethod(req, ['GET']);

  await enforceRateLimit(req, { bucket: 'store-config', limit: 120, windowSeconds: 60 });

  const settings = await loadShippingSettings();
  const provider = getPaymentProvider();
  const status = paymentProviderStatus();

  return ok(res, {
    store_name: 'Hasswell London',
    currency: storeCurrency(settings),
    payment_provider: provider?.name ?? null,
    payment_status: status,
    shipping_countries: shippingRegions(settings),
    shipping_note: shippingNote(settings)
  });
});
