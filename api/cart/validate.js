import { handler, ok, assertMethod, requireJson, readJson } from '../_lib/http.js';
import { validateCartItems } from '../_lib/validate.js';
import { resolveCart } from '../_lib/cart-service.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import {
  loadShippingSettings,
  calculateShipping,
  shippingNote,
  shippingRegions,
  storeCurrency
} from '../_lib/shipping.js';
import { getPaymentProvider } from '../../integrations/payments/registry.js';

export default handler(async (req, res) => {
  assertMethod(req, ['POST']);
  requireJson(req);

  await enforceRateLimit(req, { bucket: 'cart-validate', limit: 120, windowSeconds: 60, failClosed: false });

  const body = await readJson(req, { maxBytes: 32 * 1024 });
  const requested = validateCartItems(body.items);
  const [cart, settings] = await Promise.all([resolveCart(requested), loadShippingSettings()]);

  const shippingMinor = calculateShipping(cart.subtotal_minor, settings);

  return ok(res, {
    items: cart.items,
    subtotal_minor: cart.subtotal_minor,
    shipping_minor: shippingMinor,
    total_minor: cart.subtotal_minor + shippingMinor,
    currency: storeCurrency(settings),
    issues: cart.issues,
    removed_count: cart.removed_count,
    shipping_countries: shippingRegions(settings),
    shipping_note: shippingNote(settings),
    payment_provider: getPaymentProvider()?.name ?? null
  });
});
