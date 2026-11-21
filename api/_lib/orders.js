import { serviceClient, translateDbError } from './supabase.js';
import { AppError } from './http.js';
import { env, siteUrl } from './env.js';
import { sendOrderEmail } from './email.js';

/**
 * Order helpers shared by checkout, payment webhooks, the customer status page
 * and admin endpoints. Public projections deliberately exclude internal notes,
 * supplier references and idempotency keys.
 */

export function manualPaymentInstructions(orderNumber) {
  const custom = env('MANUAL_PAYMENT_INSTRUCTIONS', '')?.trim();
  const accountName = env('MANUAL_PAYMENT_ACCOUNT_NAME', '')?.trim();
  const sortCode = env('MANUAL_PAYMENT_SORT_CODE', '')?.trim();
  const accountNumber = env('MANUAL_PAYMENT_ACCOUNT_NUMBER', '')?.trim();

  const lines = [];
  if (custom) lines.push(...custom.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  if (accountName) lines.push(`Account name: ${accountName}`);
  if (sortCode) lines.push(`Sort code: ${sortCode}`);
  if (accountNumber) lines.push(`Account number: ${accountNumber}`);
  if (orderNumber) lines.push(`Payment reference: ${orderNumber}`);

  return lines.length ? lines.join('\n') : null;
}

export function isManualPaymentConfigured() {
  const custom = env('MANUAL_PAYMENT_INSTRUCTIONS', '')?.trim();
  const hasBank =
    Boolean(env('MANUAL_PAYMENT_SORT_CODE', '')?.trim()) &&
    Boolean(env('MANUAL_PAYMENT_ACCOUNT_NUMBER', '')?.trim());
  return Boolean(custom) || hasBank;
}

export function orderAccessUrl(order) {
  return `${siteUrl()}/order-confirmation?order=${encodeURIComponent(
    order.order_number
  )}&token=${encodeURIComponent(order.access_token)}`;
}

const PUBLIC_ORDER_COLUMNS = [
  'id',
  'order_number',
  'access_token',
  'email',
  'shipping_name',
  'shipping_line1',
  'shipping_line2',
  'shipping_city',
  'shipping_region',
  'shipping_postcode',
  'shipping_country',
  'subtotal_minor',
  'shipping_minor',
  'discount_minor',
  'total_minor',
  'currency',
  'status',
  'payment_status',
  'fulfilment_status',
  'payment_provider',
  'carrier',
  'tracking_number',
  'tracking_url',
  'placed_at',
  'paid_at',
  'dispatched_at',
  'delivered_at',
  'cancelled_at',
  'cancel_reason',
  'created_at'
].join(', ');

export async function getOrderByAccess(orderNumber, token) {
  if (!orderNumber || !token) {
    throw new AppError('ORDER_NOT_FOUND', 'That order could not be found.', 404);
  }
  const { data, error } = await serviceClient()
    .from('orders')
    .select(PUBLIC_ORDER_COLUMNS)
    .eq('order_number', String(orderNumber).trim())
    .eq('access_token', String(token).trim())
    .maybeSingle();

  if (error) throw translateDbError(error);
  if (!data) throw new AppError('ORDER_NOT_FOUND', 'That order could not be found.', 404);
  return data;
}

export async function getOrderById(id) {
  const { data, error } = await serviceClient()
    .from('orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw translateDbError(error);
  if (!data) throw new AppError('ORDER_NOT_FOUND', 'That order could not be found.', 404);
  return data;
}

export async function getOrderItems(orderId) {
  const { data, error } = await serviceClient()
    .from('order_items')
    .select(
      'id, product_id, variant_id, sku, name, variant_name, unit_price_minor, quantity, line_total_minor, supplier_sku'
    )
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw translateDbError(error);
  return data ?? [];
}

export function paymentDetails(order) {
  const provider = order.payment_provider || (order.payment_status === 'pending' ? 'manual' : null);
  const pending = order.payment_status === 'pending' && order.status === 'pending_payment';

  if (pending && provider === 'manual') {
    return {
      provider: 'manual',
      instructions: manualPaymentInstructions(order.order_number)
    };
  }
  return { provider, instructions: null };
}

/** Customer-facing projection. */
export function publicOrder(order, items = []) {
  return {
    order_number: order.order_number,
    status: order.status,
    payment_status: order.payment_status,
    fulfilment_status: order.fulfilment_status,
    paid_at: order.paid_at,
    dispatched_at: order.dispatched_at,
    delivered_at: order.delivered_at,
    created_at: order.created_at,
    placed_at: order.placed_at,
    subtotal_minor: order.subtotal_minor,
    shipping_minor: order.shipping_minor,
    total_minor: order.total_minor,
    currency: order.currency,
    email: order.email,
    shipping: {
      name: order.shipping_name,
      line1: order.shipping_line1,
      line2: order.shipping_line2,
      city: order.shipping_city,
      region: order.shipping_region,
      postcode: order.shipping_postcode,
      country: order.shipping_country
    },
    items: items.map((item) => ({
      name: item.name,
      variant_name: item.variant_name,
      quantity: item.quantity,
      unit_price_minor: item.unit_price_minor,
      line_total_minor: item.line_total_minor
    })),
    tracking: {
      carrier: order.carrier || null,
      number: order.tracking_number || null,
      url: order.tracking_url || null
    },
    payment: paymentDetails(order),
    ...(order.status === 'cancelled' && order.cancel_reason ? { cancel_reason: order.cancel_reason } : {})
  };
}

/**
 * Verifies and records a successful payment. This must only be called after
 * the provider has been checked server-side (webhook signature, admin action).
 */
export async function markOrderPaid({ orderId, provider, reference, amountMinor, currency = 'GBP', raw = {} }) {
  const { data, error } = await serviceClient().rpc('mark_order_paid', {
    p_order_id: orderId,
    p_provider: provider,
    p_provider_reference: reference,
    p_amount_minor: amountMinor,
    p_currency: currency,
    p_raw: raw
  });

  if (error) throw translateDbError(error);

  if (!data?.already_paid) {
    try {
      const order = await getOrderById(orderId);
      const items = await getOrderItems(orderId);
      await sendOrderEmail('payment_confirmed', { order, items });
    } catch (emailError) {
      console.error('[orders] confirmation email failed:', emailError?.message || emailError);
    }
  }

  return data;
}

export async function sendDispatchEmail(orderId) {
  try {
    const order = await getOrderById(orderId);
    await sendOrderEmail('order_dispatched', { order });
  } catch (error) {
    console.error('[orders] dispatch email failed:', error?.message || error);
  }
}

export async function sendCancellationEmail(orderId, reason) {
  try {
    const order = await getOrderById(orderId);
    await sendOrderEmail('order_cancelled', { order, reason });
  } catch (error) {
    console.error('[orders] cancellation email failed:', error?.message || error);
  }
}
