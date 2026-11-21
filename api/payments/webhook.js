import { handler, ok, AppError, assertMethod, readRawBody } from '../_lib/http.js';
import { serviceClient } from '../_lib/supabase.js';
import { env } from '../_lib/env.js';
import { markOrderPaid } from '../_lib/orders.js';
import { verifyStripeSignature } from '../../integrations/payments/stripe.js';

/**
 * Stripe webhook.
 *
 * The raw body is verified against the stripe-signature header before any
 * database write. Payment is only marked paid after Stripe reports a completed
 * session (or an asynchronous payment success).
 */
export default handler(async (req, res) => {
  assertMethod(req, ['POST']);

  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (!secret) {
    throw new AppError('WEBHOOK_NOT_CONFIGURED', 'Webhook is not configured.', 503);
  }

  const payload = await readRawBody(req, { maxBytes: 512 * 1024 });
  verifyStripeSignature({
    payload,
    header: req.headers['stripe-signature'],
    secret
  });

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    throw new AppError('INVALID_JSON', 'Webhook body must be valid JSON.', 400);
  }

  const type = String(event?.type || '');
  const session = event?.data?.object ?? {};

  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    const orderId = session?.metadata?.order_id;
    const amountMinor = session?.amount_total;
    const currency = String(session?.currency || 'gbp').toUpperCase();

    if (!orderId) {
      console.warn('[stripe] received session without order metadata:', session?.id);
      return ok(res, { received: true, ignored: 'missing_order_reference' });
    }

    if (type === 'checkout.session.completed' && session.payment_status !== 'paid') {
      return ok(res, { received: true, ignored: 'payment_not_captured' });
    }

    if (!Number.isInteger(amountMinor) || amountMinor < 0) {
      throw new AppError('INVALID_WEBHOOK', 'Webhook is missing a valid amount.', 400);
    }

    try {
      await markOrderPaid({
        orderId,
        provider: 'stripe',
        reference: String(session.id),
        amountMinor,
        currency,
        raw: {
          event_id: event.id,
          event_type: type,
          payment_intent: session.payment_intent ?? null,
          livemode: Boolean(event.livemode)
        }
      });
    } catch (error) {
      // Returning a non-2xx makes Stripe retry. Log a safe summary first.
      console.error('[stripe] mark paid failed:', error?.code || error?.message);
      throw error;
    }
  }

  return ok(res, { received: true });
});
