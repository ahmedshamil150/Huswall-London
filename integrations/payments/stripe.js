import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../api/_lib/env.js';
import { formatMoney } from '../../api/_lib/email-templates.js';
import { PaymentError } from './provider.js';

/**
 * Stripe adapter using the REST API directly (no SDK).
 *
 * Card data is collected by Stripe Checkout on Stripe's domain. This server
 * only creates the session, then verifies the signed webhook before marking an
 * order paid.
 */

const API = 'https://api.stripe.com/v1';

function secretKey() {
  return env('STRIPE_SECRET_KEY');
}

async function stripeRequest(path, { method = 'POST', body } = {}) {
  const key = secretKey();
  if (!key) {
    throw new PaymentError('PAYMENT_NOT_CONFIGURED', 'Stripe is not configured.', { status: 503 });
  }

  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
      },
      ...(body ? { body: body.toString() } : {}),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new PaymentError('PAYMENT_NETWORK_ERROR', 'The payment provider could not be reached.', {
      status: 504
    });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Stripe responded ${response.status}.`;
    throw new PaymentError('PAYMENT_PROVIDER_ERROR', String(message).slice(0, 300), { status: 502 });
  }
  return payload;
}

export function isStripeConfigured() {
  return Boolean(env('STRIPE_SECRET_KEY') && env('STRIPE_WEBHOOK_SECRET'));
}

/**
 * Creates a hosted Checkout session whose total exactly matches the order.
 * Delivery is added as its own line so no money is invented or lost.
 */
export async function createStripeCheckout({ order, items, successUrl, cancelUrl }) {
  if (!isStripeConfigured()) {
    throw new PaymentError('PAYMENT_NOT_CONFIGURED', 'Stripe is not configured.', { status: 503 });
  }

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('client_reference_id', order.id);
  params.set('customer_email', order.email);
  params.set('submit_type', 'pay');
  // Stock is reserved for 24 hours; give the customer a shorter, explicit window.
  params.set('expires_at', String(Math.floor(Date.now() / 1000) + 3600));
  params.set('metadata[order_id]', order.id);
  params.set('metadata[order_number]', order.order_number);
  params.set('payment_intent_data[metadata][order_id]', order.id);
  params.set('payment_intent_data[metadata][order_number]', order.order_number);

  const methodTypes = String(env('STRIPE_PAYMENT_METHOD_TYPES', 'card'))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const [index, type] of methodTypes.entries()) {
    params.set(`payment_method_types[${index}]`, type);
  }

  items.forEach((item, index) => {
    const name = item.variant_name ? `${item.name} — ${item.variant_name}` : item.name;
    params.set(`line_items[${index}][price_data][currency]`, String(order.currency || 'GBP').toLowerCase());
    params.set(`line_items[${index}][price_data][product_data][name]`, name.slice(0, 250));
    params.set(`line_items[${index}][price_data][unit_amount]`, String(item.unit_price_minor));
    params.set(`line_items[${index}][quantity]`, String(item.quantity));
  });

  if (Number(order.shipping_minor) > 0) {
    const index = items.length;
    params.set(`line_items[${index}][price_data][currency]`, String(order.currency || 'GBP').toLowerCase());
    params.set(`line_items[${index}][price_data][product_data][name]`, 'Delivery');
    params.set(`line_items[${index}][price_data][unit_amount]`, String(order.shipping_minor));
    params.set(`line_items[${index}][quantity]`, '1');
  }

  const session = await stripeRequest('/checkout/sessions', { method: 'POST', body: params });

  if (!session?.url) {
    throw new PaymentError('PAYMENT_INIT_FAILED', 'The payment page could not be created.', {
      status: 502
    });
  }

  return {
    provider: 'stripe',
    reference: session.id,
    redirect_url: session.url,
    amount_minor: session.amount_total ?? order.total_minor,
    currency: String(session.currency || order.currency || 'GBP').toUpperCase(),
    instructions: null
  };
}

export async function retrieveStripeSession(sessionId) {
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    throw new PaymentError('INVALID_PAYMENT_REFERENCE', 'Invalid payment reference.', { status: 400 });
  }
  return stripeRequest(`/checkout/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
}

/**
 * Verifies the Stripe-Signature header:
 *   t=<timestamp>,v1=<hmac-sha256(secret, `${t}.${payload}`)>
 */
export function verifyStripeSignature({ payload, header, secret, toleranceSeconds = 300 }) {
  if (!secret) {
    throw new PaymentError('WEBHOOK_NOT_CONFIGURED', 'Webhook secret is not configured.', { status: 503 });
  }
  if (!header || typeof header !== 'string' || !payload) {
    throw new PaymentError('INVALID_SIGNATURE', 'Missing webhook signature.', { status: 400 });
  }

  const parts = header.split(',').map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith('t='));
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));

  if (!timestampPart || signatures.length === 0) {
    throw new PaymentError('INVALID_SIGNATURE', 'Malformed webhook signature.', { status: 400 });
  }

  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isFinite(timestamp)) {
    throw new PaymentError('INVALID_SIGNATURE', 'Malformed webhook timestamp.', { status: 400 });
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) {
    throw new PaymentError('SIGNATURE_EXPIRED', 'Webhook signature has expired.', { status: 400 });
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  const matched = signatures.some((signature) => {
    try {
      const provided = Buffer.from(signature, 'utf8');
      return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
    } catch {
      return false;
    }
  });

  if (!matched) {
    throw new PaymentError('INVALID_SIGNATURE', 'Webhook signature could not be verified.', { status: 400 });
  }

  return true;
}

export function formatStripeAmount(minor, currency = 'GBP') {
  return formatMoney(minor, currency);
}
