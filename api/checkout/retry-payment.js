import { handler, ok, AppError, assertMethod, requireJson, readJson } from '../_lib/http.js';
import { serviceClient } from '../_lib/supabase.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { getOrderByAccess, getOrderItems, orderAccessUrl } from '../_lib/orders.js';
import { requirePaymentProvider } from '../../integrations/payments/registry.js';

/**
 * Creates a fresh Stripe Checkout session for an unpaid order. Only the holder
 * of the order's private access token can request this.
 */
export default handler(async (req, res) => {
  assertMethod(req, ['POST']);
  requireJson(req);

  await enforceRateLimit(req, {
    bucket: 'checkout-retry',
    limit: 10,
    windowSeconds: 600,
    failClosed: true
  });

  const body = await readJson(req, { maxBytes: 16 * 1024 });
  const order = await getOrderByAccess(body.order_number, body.token);

  if (order.payment_status !== 'pending' || order.status !== 'pending_payment') {
    throw new AppError('ORDER_NOT_PAYABLE', 'This order can no longer be paid.', 409);
  }

  const provider = requirePaymentProvider();
  const items = await getOrderItems(order.id);

  if (provider.name === 'manual') {
    const payment = await provider.createPayment({ order, items });
    return ok(res, { provider: 'manual', redirect_url: null, instructions: payment.instructions });
  }

  const payment = await provider.createPayment({
    order,
    items,
    successUrl: `${orderAccessUrl(order)}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${orderAccessUrl(order)}&cancelled=1`
  });

  if (Number.isInteger(payment.amount_minor) && payment.amount_minor !== order.total_minor) {
    throw new AppError(
      'PAYMENT_AMOUNT_MISMATCH',
      'The payment amount did not match the order total. Please contact us before paying.',
      502
    );
  }

  const db = serviceClient();
  await db.from('orders').update({ payment_provider: provider.name }).eq('id', order.id);
  await db.from('payment_transactions').upsert(
    {
      order_id: order.id,
      provider: provider.name,
      provider_reference: payment.reference,
      amount_minor: order.total_minor,
      currency: order.currency,
      status: 'pending',
      raw_payload: { checkout_session_id: payment.reference }
    },
    { onConflict: 'provider,provider_reference' }
  );

  return ok(res, {
    provider: provider.name,
    redirect_url: payment.redirect_url,
    instructions: null
  });
});
