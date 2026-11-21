import { randomUUID } from 'node:crypto';
import { handler, ok, AppError, assertMethod, requireJson, readJson } from '../_lib/http.js';
import { serviceClient, translateDbError, getAuthenticatedUser } from '../_lib/supabase.js';
import { validateCheckoutInput, validateIdempotencyKey } from '../_lib/validate.js';
import { resolveCart } from '../_lib/cart-service.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import {
  loadShippingSettings,
  calculateShipping,
  shippingRegions,
  storeCurrency
} from '../_lib/shipping.js';
import { getOrderById, getOrderItems, markOrderPaid, orderAccessUrl } from '../_lib/orders.js';
import { sendOrderEmail } from '../_lib/email.js';
import { requirePaymentProvider } from '../../integrations/payments/registry.js';

/**
 * Creates an order, reserves stock and starts payment.
 *
 * Guarantees:
 *  * prices, shipping and stock are recalculated server-side;
 *  * stock is reserved inside the create_order() transaction;
 *  * no order is created without a configured payment provider;
 *  * a repeated Idempotency-Key returns the original order.
 */
export default handler(async (req, res) => {
  assertMethod(req, ['POST']);
  requireJson(req);

  await enforceRateLimit(req, {
    bucket: 'checkout-create',
    limit: 8,
    windowSeconds: 600,
    failClosed: true
  });

  const body = await readJson(req, { maxBytes: 64 * 1024 });
  const settings = await loadShippingSettings();
  const input = validateCheckoutInput(body, { allowedCountries: shippingRegions(settings) });
  const provider = requirePaymentProvider();

  // If stock changed between bag review and submit, stop and ask the customer
  // to review rather than silently adjusting what they are charged.
  const cart = await resolveCart(input.items);
  if (!cart.items.length) {
    throw new AppError('CART_EMPTY', 'Your bag is empty.', 400);
  }
  if (cart.issues.length) {
    throw new AppError(
      'CART_CHANGED',
      'Availability has changed since you reviewed your bag. Please return to your bag to confirm the updated items.',
      409,
      { issues: cart.issues, removed_count: cart.removed_count }
    );
  }

  const shippingMinor = calculateShipping(cart.subtotal_minor, settings);
  const currency = storeCurrency(settings);
  const user = await getAuthenticatedUser(req);
  const idempotencyKey =
    validateIdempotencyKey(req.headers['idempotency-key']) ?? `srv-${randomUUID()}`;

  const itemsPayload = cart.items.map((item) => ({
    product_id: item.product_id,
    variant_id: item.variant_id,
    quantity: item.quantity
  }));

  const { data: created, error } = await serviceClient().rpc('create_order', {
    p_items: itemsPayload,
    p_customer: input.customer,
    p_shipping_minor: shippingMinor,
    p_user_id: user?.id ?? null,
    p_idempotency_key: idempotencyKey,
    p_customer_notes: input.customer_notes || null,
    p_delivery_notes: input.delivery_notes || null
  });

  if (error) throw translateDbError(error);
  if (created?.currency && String(created.currency).toUpperCase() !== currency) {
    throw new AppError('CURRENCY_MISMATCH', 'The store currency changed. Please refresh and try again.', 409);
  }

  const order = await getOrderById(created.id);
  const orderItems = await getOrderItems(created.id);

  // Idempotent replay: never create a second payment session.
  if (created.idempotent_replay) {
    if (order.payment_status === 'paid') {
      return ok(res, {
        order_number: order.order_number,
        access_token: order.access_token,
        total_minor: order.total_minor,
        currency: order.currency,
        payment: { provider: order.payment_provider || provider.name, redirect_url: null, instructions: null }
      });
    }

    return ok(res, {
      order_number: order.order_number,
      access_token: order.access_token,
      total_minor: order.total_minor,
      currency: order.currency,
      payment: {
        provider: provider.name,
        redirect_url: null,
        instructions:
          provider.name === 'manual'
            ? (await provider.createPayment({ order, items: orderItems })).instructions
            : null
      }
    });
  }

  let payment;
  try {
    payment = await provider.createPayment({
      order,
      items: orderItems,
      successUrl: `${orderAccessUrl(order)}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${orderAccessUrl(order)}&cancelled=1`
    });

    if (Number.isInteger(payment.amount_minor) && payment.amount_minor !== order.total_minor) {
      throw new AppError(
        'PAYMENT_AMOUNT_MISMATCH',
        'The payment amount did not match the order total. Please contact us before paying.',
        502,
        { order_number: order.order_number, access_token: order.access_token }
      );
    }
  } catch (error) {
    await serviceClient()
      .from('order_events')
      .insert({
        order_id: order.id,
        event_type: 'payment_initialisation_failed',
        message: String(error?.message || 'Payment initialisation failed.').slice(0, 300),
        actor: 'system'
      })
      .then(() => null, () => null);

    const wrapped = new AppError(
      'PAYMENT_INIT_FAILED',
      'Your order was reserved, but the payment page could not be opened. Do not pay again — open your order and retry payment, or contact us.',
      502,
      {
        order_number: order.order_number,
        access_token: order.access_token,
        confirmation_url: orderAccessUrl(order)
      }
    );
    wrapped.expose = true;
    throw wrapped;
  }

  const db = serviceClient();
  await db.from('orders').update({ payment_provider: provider.name }).eq('id', order.id);

  if (provider.name === 'stripe' && payment.reference) {
    const { error: txError } = await db.from('payment_transactions').upsert(
      {
        order_id: order.id,
        provider: 'stripe',
        provider_reference: payment.reference,
        amount_minor: order.total_minor,
        currency: order.currency,
        status: 'pending',
        raw_payload: { checkout_session_id: payment.reference }
      },
      { onConflict: 'provider,provider_reference' }
    );
    if (txError) console.error('[checkout] could not record pending payment:', txError.message);
  }

  order.payment_provider = provider.name;
  await sendOrderEmail('order_received', {
    order,
    items: orderItems,
    payment: { provider: provider.name, instructions: payment.instructions }
  });

  return ok(
    res,
    {
      order_number: order.order_number,
      access_token: order.access_token,
      total_minor: order.total_minor,
      currency: order.currency,
      payment: {
        provider: provider.name,
        redirect_url: payment.redirect_url || null,
        ...(payment.instructions ? { instructions: payment.instructions } : {})
      }
    },
    201
  );
});
