import { createHash } from 'node:crypto';
import { handler, ok, fail, AppError, assertMethod, requireJson, json } from './_lib/http.js';
import { serviceClient, requireAdmin, translateDbError, getAuthenticatedUser } from './_lib/supabase.js';
import { env, siteUrl, flags } from './_lib/env.js';
import { enforceRateLimit } from './_lib/rate-limit.js';
import { validateCartItems, validateCheckoutInput, validateContactInput, validateNewsletterInput, validateIdempotencyKey, normaliseEmail, isEmail } from './_lib/validate.js';
import { parsePagination, slugify, cleanSlug, validateProductInput, SETTINGS_SPEC, validateSettingsInput, cleanText, cleanMultiline, asInt, asBoolean } from './_lib/admin.js';
import { resolveCart } from './_lib/cart-service.js';
import { loadShippingSettings, calculateShipping, shippingRegions, shippingNote, storeCurrency } from './_lib/shipping.js';
import { getPaymentProvider, requirePaymentProvider, paymentProviderStatus } from '../../integrations/payments/registry.js';
import { createSupplierConnector } from '../../integrations/suppliers/registry.js';
import { syncSupplier, refreshSupplierOrderStatus } from '../../integrations/suppliers/aw-dropship/sync-service.js';
import { sendOrderEmail, sendSafely } from './_lib/email.js';
import {
  getOrderByAccess, getOrderById, getOrderItems, markOrderPaid, orderAccessUrl, manualPaymentInstructions,
  sendDispatchEmail, sendCancellationEmail, publicOrder
} from './_lib/orders.js';
import { validateImages, validateCategoryIds, validateVariants } from './_lib/admin.js';
import { loadAdminProduct, replaceImages, replaceCategories, syncVariants } from './_lib/product-admin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function originalUrl(req) {
  const rewriteSource = req.headers['x-vercel-rewrite-source'];
  return typeof rewriteSource === 'string' ? rewriteSource : req.url;
}

function pathSegments(req) {
  const url = new URL(originalUrl(req), 'http://localhost');
  return url.pathname.slice('/api'.length).split('/').filter(Boolean);
}

async function readBody(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large.', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('INVALID_JSON', 'Request body must be valid JSON.', 400);
  }
}

function requireContentTypeJson(req) {
  const type = req.headers['content-type'] || '';
  if (!type.includes('application/json')) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.', 415);
  }
}

/* ========================================================================
   Route handlers
   ======================================================================== */

async function handleHealth(req, res) {
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
      configured: env('EMAIL_PROVIDER', 'log') === 'log'
        ? true
        : Boolean(env('RESEND_API_KEY') && env('EMAIL_FROM'))
    },
    supplier: {
      token_configured: Boolean(env('AW_DROPSHIP_API_TOKEN')),
      order_submission_enabled: env('AW_DROPSHIP_ORDER_SUBMISSION_ENABLED', 'false') === 'true'
    }
  };
  try {
    const { error } = await serviceClient().from('store_settings').select('key', { head: true, count: 'exact' }).limit(1);
    checks.database = error ? 'error' : 'ok';
  } catch { checks.database = 'error'; }
  const healthy = checks.database === 'ok' && checks.environment.supabase && checks.payments.available && checks.environment.cron_secret;
  return ok(res, { status: healthy ? 'ok' : 'degraded', checks });
}

async function handleRobots(req, res) {
  assertMethod(req, ['GET']);
  const base = siteUrl();
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin/
Disallow: /api/
Disallow: /cart
Disallow: /checkout
Disallow: /order-confirmation
Disallow: /account
Disallow: /login
Disallow: /register

Sitemap: ${base}/sitemap.xml
`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.end(body);
}

async function handleSitemap(req, res) {
  assertMethod(req, ['GET']);
  const base = siteUrl();
  const escapeXml = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
  const STATIC_PAGES = [
    { path: '/', changefreq: 'weekly', priority: '1.0' },
    { path: '/shop', changefreq: 'daily', priority: '0.9' },
    { path: '/about', changefreq: 'monthly', priority: '0.5' },
    { path: '/contact', changefreq: 'monthly', priority: '0.4' },
    { path: '/delivery-returns', changefreq: 'monthly', priority: '0.4' },
    { path: '/faqs', changefreq: 'monthly', priority: '0.4' },
    { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
    { path: '/cookies', changefreq: 'yearly', priority: '0.3' },
    { path: '/terms', changefreq: 'yearly', priority: '0.3' }
  ];
  let products = [];
  let categories = [];
  try {
    const db = serviceClient();
    const [productResult, categoryResult] = await Promise.all([
      db.from('products').select('slug, updated_at').eq('status', 'active').order('published_at', { ascending: false }),
      db.from('categories').select('slug, updated_at').eq('is_active', true).order('sort_order')
    ]);
    products = productResult.data ?? [];
    categories = categoryResult.data ?? [];
  } catch (error) { console.error('[sitemap] catalogue query failed:', error?.message); }
  const urls = [
    ...STATIC_PAGES.map((page) => `  <url>
    <loc>${escapeXml(`${base}${page.path}`)}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`),
    ...categories.map((category) => `  <url>
    <loc>${escapeXml(`${base}/shop?category=${encodeURIComponent(category.slug)}`)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`),
    ...products.map((product) => `  <url>
    <loc>${escapeXml(`${base}/product/${encodeURIComponent(product.slug)}`)}</loc>
    ${product.updated_at ? `<lastmod>${new Date(product.updated_at).toISOString()}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`)
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.end(xml);
}

async function handleStoreConfig(req, res) {
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
}

async function handleContact(req, res) {
  assertMethod(req, ['POST']);
  requireContentTypeJson(req);
  await enforceRateLimit(req, { bucket: 'contact', limit: 5, windowSeconds: 3600, failClosed: true });
  const body = await readBody(req, 32 * 1024);
  const name = cleanText(body.name, { max: 120 });
  const email = normaliseEmail(body.email);
  const subject = cleanText(body.subject, { max: 160 });
  const message = cleanMultiline(body.message, { max: 4000 });
  if (name.length < 2) throw new AppError('INVALID_NAME', 'Enter your name.', 400, { field: 'name' });
  if (!isEmail(email)) throw new AppError('INVALID_EMAIL', 'Enter a valid email address.', 400, { field: 'email' });
  if (message.length < 10) throw new AppError('MESSAGE_TOO_SHORT', 'Please add a little more detail to your message.', 400, { field: 'message' });
  const db = serviceClient();
  const { error } = await db.from('contact_messages').insert({ name, email, subject, message });
  if (error) throw error;
  let storeEmail = null;
  try {
    const { data } = await db.from('store_settings').select('value').eq('key', 'store.email').maybeSingle();
    storeEmail = typeof data?.value === 'string' ? data.value : null;
  } catch { storeEmail = null; }
  const built = contactNotificationEmail({ message: { name, email, subject, message }, siteUrl: siteUrl() });
  await sendSafely({
    to: storeEmail,
    template: 'contact_notification',
    subject: built.subject,
    html: built.html,
    text: built.text,
    replyTo: built.replyTo
  });
  return ok(res, { message: 'Thank you. Your message has been received and our team will reply by email.' });
}

async function handleNewsletter(req, res) {
  assertMethod(req, ['POST']);
  requireContentTypeJson(req);
  await enforceRateLimit(req, { bucket: 'newsletter', limit: 5, windowSeconds: 3600, failClosed: true });
  const body = await readBody(req, 8 * 1024);
  const email = normaliseEmail(body?.email);
  const source = cleanText(body?.source, { max: 40 }) || 'website';
  if (!isEmail(email)) throw new AppError('INVALID_EMAIL', 'Enter a valid email address.', 400, { field: 'email' });
  const allowedSources = ['storefront', 'footer', 'popup'];
  const finalSource = allowedSources.includes(source) ? source : 'website';
  const db = serviceClient();
  const { data: existing, error: readError } = await db.from('newsletter_subscribers').select('id').eq('email', email).maybeSingle();
  if (readError) throw readError;
  if (!existing) {
    const { error } = await db.from('newsletter_subscribers').insert({ email, source: finalSource, confirmed: false });
    if (error && error.code !== '23505') throw error;
  }
  return ok(res, { message: 'Thank you — you are on the list.', confirmation_email_sent: false });
}

async function handleCartValidate(req, res) {
  assertMethod(req, ['POST']);
  requireContentTypeJson(req);
  await enforceRateLimit(req, { bucket: 'cart-validate', limit: 120, windowSeconds: 60, failClosed: false });
  const body = await readBody(req, 32 * 1024);
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
}

async function handleCheckoutCreateOrder(req, res) {
  assertMethod(req, ['POST']);
  requireContentTypeJson(req);
  await enforceRateLimit(req, { bucket: 'checkout-create', limit: 8, windowSeconds: 600, failClosed: true });
  const body = await readBody(req, 64 * 1024);
  const settings = await loadShippingSettings();
  const input = validateCheckoutInput(body, { allowedCountries: shippingRegions(settings) });
  const provider = requirePaymentProvider();
  const cart = await resolveCart(input.items);
  if (!cart.items.length) throw new AppError('CART_EMPTY', 'Your bag is empty.', 400);
  if (cart.issues.length) {
    throw new AppError('CART_CHANGED', 'Availability has changed since you reviewed your bag. Please return to your bag to confirm the updated items.', 409, { issues: cart.issues, removed_count: cart.removed_count });
  }
  const shippingMinor = calculateShipping(cart.subtotal_minor, settings);
  const currency = storeCurrency(settings);
  const user = await getAuthenticatedUser(req);
  const idempotencyKey = validateIdempotencyKey(req.headers['idempotency-key']) ?? `srv-${randomUUID()}`;
  const itemsPayload = cart.items.map((item) => ({ product_id: item.product_id, variant_id: item.variant_id, quantity: item.quantity }));
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
  if (created.idempotent_replay) {
    if (order.payment_status === 'paid') {
      return ok(res, { order_number: order.order_number, access_token: order.access_token, total_minor: order.total_minor, currency: order.currency, payment: { provider: order.payment_provider || provider.name, redirect_url: null, instructions: null } });
    }
    return ok(res, { order_number: order.order_number, access_token: order.access_token, total_minor: order.total_minor, currency: order.currency, payment: { provider: provider.name, redirect_url: null, instructions: provider.name === 'manual' ? (await provider.createPayment({ order, items: orderItems })).instructions : null } });
  }
  let payment;
  try {
    payment = await provider.createPayment({ order, items: orderItems, successUrl: `${orderAccessUrl(order)}&session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${orderAccessUrl(order)}&cancelled=1` });
    if (Number.isInteger(payment.amount_minor) && payment.amount_minor !== order.total_minor) {
      throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'The payment amount did not match the order total. Please contact us before paying.', 502, { order_number: order.order_number, access_token: order.access_token });
    }
  } catch (error) {
    await serviceClient().from('order_events').insert({ order_id: order.id, event_type: 'payment_initialisation_failed', message: String(error?.message || 'Payment initialisation failed.').slice(0, 300), actor: 'system' }).then(() => null, () => null);
    const wrapped = new AppError('PAYMENT_INIT_FAILED', 'Your order was reserved, but the payment page could not be opened. Do not pay again — open your order and retry payment, or contact us.', 502, { order_number: order.order_number, access_token: order.access_token, confirmation_url: orderAccessUrl(order) });
    wrapped.expose = true;
    throw wrapped;
  }
  const db = serviceClient();
  await db.from('orders').update({ payment_provider: provider.name }).eq('id', order.id);
  if (provider.name === 'stripe' && payment.reference) {
    const { error: txError } = await db.from('payment_transactions').upsert({ order_id: order.id, provider: 'stripe', provider_reference: payment.reference, amount_minor: order.total_minor, currency: order.currency, status: 'pending', raw_payload: { checkout_session_id: payment.reference } }, { onConflict: 'provider,provider_reference' });
    if (txError) console.error('[checkout] could not record pending payment:', txError.message);
  }
  order.payment_provider = provider.name;
  await sendOrderEmail('order_received', { order, items: orderItems, payment: { provider: provider.name, instructions: payment.instructions } });
  return ok(res, { order_number: order.order_number, access_token: order.access_token, total_minor: order.total_minor, currency: order.currency, payment: { provider: provider.name, redirect_url: payment.redirect_url || null, ...(payment.instructions ? { instructions: payment.instructions } : {}) } }, 201);
}

async function handleCheckoutRetryPayment(req, res) {
  assertMethod(req, ['POST']);
  requireContentTypeJson(req);
  await enforceRateLimit(req, { bucket: 'checkout-retry', limit: 10, windowSeconds: 600, failClosed: true });
  const body = await readBody(req, 16 * 1024);
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
  const payment = await provider.createPayment({ order, items, successUrl: `${orderAccessUrl(order)}&session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${orderAccessUrl(order)}&cancelled=1` });
  if (Number.isInteger(payment.amount_minor) && payment.amount_minor !== order.total_minor) {
    throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'The payment amount did not match the order total. Please contact us before paying.', 502);
  }
  const db = serviceClient();
  await db.from('orders').update({ payment_provider: provider.name }).eq('id', order.id);
  await db.from('payment_transactions').upsert({ order_id: order.id, provider: provider.name, provider_reference: payment.reference, amount_minor: order.total_minor, currency: order.currency, status: 'pending', raw_payload: { checkout_session_id: payment.reference } }, { onConflict: 'provider,provider_reference' });
  return ok(res, { provider: provider.name, redirect_url: payment.redirect_url, instructions: null });
}

async function handleOrdersStatus(req, res) {
  assertMethod(req, ['GET']);
  await enforceRateLimit(req, { bucket: 'order-status', limit: 120, windowSeconds: 60 });
  const url = new URL(originalUrl(req), 'http://localhost');
  const orderNumber = url.searchParams.get('order');
  const token = url.searchParams.get('token');
  const order = await getOrderByAccess(orderNumber, token);
  const items = await getOrderItems(order.id);
  return ok(res, { order: publicOrder(order, items) });
}

async function handlePaymentsWebhook(req, res) {
  assertMethod(req, ['POST']);
  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (!secret) {
    return fail(res, Object.assign(new Error('Webhook is not configured.'), { code: 'WEBHOOK_NOT_CONFIGURED', status: 503 }));
  }
  const body = await readBody(req, 512 * 1024);
  try {
    const { verifyStripeSignature } = await import('../../integrations/payments/stripe.js');
    verifyStripeSignature({ payload: body, header: req.headers['stripe-signature'], secret });
  } catch (error) {
    return fail(res, Object.assign(new Error('Invalid Stripe signature.'), { code: 'INVALID_SIGNATURE', status: 400, expose: true }));
  }
  let event;
  try { event = JSON.parse(Buffer.from(body).toString('utf8')); } catch {
    return fail(res, Object.assign(new Error('Webhook body must be valid JSON.'), { code: 'INVALID_JSON', status: 400 }));
  }
  const type = String(event?.type || '');
  const session = event?.data?.object ?? {};
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    const orderId = session?.metadata?.order_id;
    const amountMinor = session?.amount_total;
    const currency = String(session?.currency || 'gbp').toUpperCase();
    if (!orderId) {
      console.warn('[stripe] received session without order metadata:', session?.id);
      return ok(res, { ok: true, received: true, ignored: 'missing_order_reference' });
    }
    if (type === 'checkout.session.completed' && session.payment_status !== 'paid') {
      return ok(res, { ok: true, received: true, ignored: 'payment_not_captured' });
    }
    if (!Number.isInteger(amountMinor) || amountMinor < 0) {
      return fail(res, Object.assign(new Error('Webhook is missing a valid amount.'), { code: 'INVALID_WEBHOOK', status: 400 }));
    }
    await markOrderPaid({ orderId, provider: 'stripe', reference: String(session.id), amountMinor, currency, raw: { event_id: event.id, event_type: type, payment_intent: session.payment_intent ?? null, livemode: Boolean(event.livemode) } });
  }
  return ok(res, { ok: true, received: true });
}

/* ========================================================================
   Admin route handlers
   ======================================================================== */

function sanitiseSearch(value) {
  return String(value || '').trim().slice(0, 80).replace(/[%,()]/g, ' ');
}

function filterValue(params, key, allowed) {
  const raw = params.get(key);
  if (raw === null || raw === '') return null;
  const value = String(raw).trim();
  if (!allowed.has(value)) throw new AppError('INVALID_FILTER', `Unknown ${key.replace('_', ' ')} filter.`, 400, { field: key });
  return value;
}

async function handleAdminDashboard(req, res) {
  assertMethod(req, ['GET']);
  const { profile } = await requireAdmin(req);
  const { data, error } = await serviceClient().rpc('admin_dashboard_stats');
  if (error) throw translateDbError(error);
  return ok(res, { admin: { email: profile.email, name: profile.full_name || profile.email }, stats: data ?? {} });
}

async function handleAdminEmailLog(req, res) {
  await requireAdmin(req);
  assertMethod(req, ['GET']);
  const { data, error } = await serviceClient().from('email_log').select('id, order_id, to_email, template, subject, status, provider, error, created_at').order('created_at', { ascending: false }).limit(100);
  if (error) throw translateDbError(error);
  return ok(res, { items: data ?? [] });
}

async function handleAdminNewsletter(req, res) {
  await requireAdmin(req);
  assertMethod(req, ['GET']);
  const url = new URL(originalUrl(req), 'http://localhost');
  const { page, pageSize, from, to } = parsePagination(url, { defaultSize: 50, maxSize: 200 });
  const { data, count, error } = await serviceClient().from('newsletter_subscribers').select('id, email, source, confirmed, created_at', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
  if (error) throw translateDbError(error);
  return ok(res, { items: data ?? [], total: count ?? 0, page, pageSize });
}

async function handleAdminInventory(req, res) {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'POST']);
  const db = serviceClient();
  if (req.method === 'GET') {
    const url = new URL(originalUrl(req), 'http://localhost');
    const lowOnly = url.searchParams.get('low') === '1';
    const q = cleanText(url.searchParams.get('q'), { max: 60 }).toLowerCase();
    const page = Math.max(1, asInt(url.searchParams.get('page'), { min: 1, max: 10000, fallback: 1 }));
    const pageSize = Math.min(100, Math.max(1, asInt(url.searchParams.get('pageSize'), { min: 1, max: 100, fallback: 50 })));
    const { data, error } = await db.from('inventory').select(`id, product_id, variant_id, stock_on_hand, stock_reserved, low_stock_threshold, supplier_stock, last_synced_at, updated_at, products ( id, name, sku, status ), product_variants ( id, name, sku, is_active )`).order('updated_at', { ascending: false }).limit(2000);
    if (error) throw translateDbError(error);
    let items = (data ?? []).map((row) => ({ ...row, available: Math.max(0, row.stock_on_hand - row.stock_reserved), product_name: row.products?.name ?? 'Unknown product', product_sku: row.products?.sku ?? '', variant_name: row.product_variants?.name ?? null, variant_sku: row.product_variants?.sku ?? null }));
    if (lowOnly) items = items.filter((row) => row.available <= row.low_stock_threshold);
    if (q) {
      items = items.filter((row) => row.product_name.toLowerCase().includes(q) || row.product_sku.toLowerCase().includes(q) || (row.variant_sku || '').toLowerCase().includes(q));
    }
    const total = items.length;
    const from = (page - 1) * pageSize;
    return ok(res, { items: items.slice(from, from + pageSize), total, page, pageSize });
  }
  requireContentTypeJson(req);
  const body = await readBody(req, 16 * 1024);
  const productId = cleanText(body.product_id, { max: 64 });
  const variantId = cleanText(body.variant_id, { max: 64 }) || null;
  const delta = asInt(body.delta, { min: -100000, max: 100000, fallback: null });
  if (!productId || delta === null || delta === 0) throw new AppError('INVALID_STOCK_CHANGE', 'Enter a non-zero stock adjustment.', 400);
  const { data, error } = await db.rpc('admin_adjust_stock', { p_product_id: productId, p_variant_id: variantId, p_delta: delta, p_note: cleanText(body.note, { max: 300 }) || null, p_actor: 'admin' });
  if (error) throw translateDbError(error);
  return ok(res, { inventory: data });
}

async function handleAdminMessages(req, res) {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'PATCH']);
  const db = serviceClient();
  const STATUSES = ['new', 'read', 'replied', 'archived'];
  if (req.method === 'GET') {
    const url = new URL(originalUrl(req), 'http://localhost');
    const { page, pageSize, from, to } = parsePagination(url, { defaultSize: 25, maxSize: 100 });
    const status = url.searchParams.get('status');
    let query = db.from('contact_messages').select('id, name, email, subject, message, status, created_at', { count: 'exact' });
    if (status && STATUSES.includes(status)) query = query.eq('status', status);
    const { data, count, error } = await query.order('created_at', { ascending: false }).range(from, to);
    if (error) throw translateDbError(error);
    return ok(res, { items: data ?? [], total: count ?? 0, page, pageSize });
  }
  requireContentTypeJson(req);
  const body = await readBody(req, 16 * 1024);
  const id = cleanText(body.id, { max: 64 });
  const status = cleanText(body.status, { max: 20 });
  if (!id || !STATUSES.includes(status)) throw new AppError('INVALID_MESSAGE', 'Choose a valid message status.', 400);
  const { error } = await db.from('contact_messages').update({ status }).eq('id', id);
  if (error) throw translateDbError(error);
  return ok(res, { updated: true });
}

async function handleAdminCategories(req, res) {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'POST']);
  const segments = pathSegments(req);
  const db = serviceClient();
  if (segments.length >= 1 && segments[0] === 'categories' && segments.length === 2) {
    const id = segments[1];
    if (!UUID_RE.test(id)) throw new AppError('INVALID_CATEGORY', 'Invalid category reference.', 400);
    if (req.method === 'DELETE') {
      const { error } = await db.from('categories').update({ is_active: false }).eq('id', id);
      if (error) throw translateDbError(error);
      return ok(res, { archived: true });
    }
    requireContentTypeJson(req);
    const body = await readBody(req, 32 * 1024);
    const update = {};
    if (body.name !== undefined) { update.name = cleanText(body.name, { max: 120 }); if (!update.name) throw new AppError('INVALID_CATEGORY', 'Enter a category name.', 400, { field: 'name' }); }
    if (body.slug !== undefined) update.slug = cleanSlug(body.slug, update.name || body.slug);
    if (body.description !== undefined) update.description = cleanText(body.description, { max: 500 }) || null;
    if (body.image_url !== undefined) update.image_url = cleanText(body.image_url, { max: 800 }) || null;
    if (body.sort_order !== undefined) update.sort_order = asInt(body.sort_order, { min: 0, max: 9999, fallback: 0 });
    if (body.is_active !== undefined) update.is_active = asBoolean(body.is_active);
    if (!Object.keys(update).length) throw new AppError('INVALID_CATEGORY', 'No changes were provided.', 400);
    const { data, error } = await db.from('categories').update(update).eq('id', id).select('*').single();
    if (error) {
      if (error.code === '23505') throw new AppError('DUPLICATE_CATEGORY', 'A category with that slug already exists.', 409);
      throw translateDbError(error);
    }
    return ok(res, { category: data });
  }
  if (segments.length === 1 && segments[0] === 'categories') {
    if (req.method === 'GET') {
      const { data, error } = await db.from('categories').select('id, parent_id, name, slug, description, image_url, sort_order, is_active, created_at, updated_at, product_categories ( product_id )').order('sort_order', { ascending: true });
      if (error) throw translateDbError(error);
      return ok(res, { items: (data ?? []).map((row) => ({ ...row, product_count: row.product_categories?.length ?? 0 })) });
    }
    requireContentTypeJson(req);
    const body = await readBody(req, 32 * 1024);
    const name = cleanText(body.name, { max: 120 });
    if (!name) throw new AppError('INVALID_CATEGORY', 'Enter a category name.', 400, { field: 'name' });
    const { data, error } = await db.from('categories').insert({ name, slug: cleanSlug(body.slug, name), description: cleanText(body.description, { max: 500 }) || null, image_url: cleanText(body.image_url, { max: 800 }) || null, sort_order: asInt(body.sort_order, { min: 0, max: 9999, fallback: 0 }), is_active: body.is_active === undefined ? true : asBoolean(body.is_active) }).select('*').single();
    if (error) {
      if (error.code === '23505') throw new AppError('DUPLICATE_CATEGORY', 'A category with that slug already exists.', 409);
      throw translateDbError(error);
    }
    return ok(res, { category: data }, 201);
  }
  throw new AppError('NOT_FOUND', 'Not found.', 404);
}

async function handleAdminOrders(req, res) {
  const { profile } = await requireAdmin(req);
  assertMethod(req, ['GET', 'PATCH', 'POST']);
  const segments = pathSegments(req);
  const id = segments[segments.length - 1];
  if (segments.length === 1 && segments[0] === 'orders') {
    // List orders
    assertMethod(req, ['GET']);
    const url = new URL(originalUrl(req), 'http://localhost');
    const { page, pageSize, from, to } = parsePagination(url, { defaultSize: 25, maxSize: 100 });
    const q = sanitiseSearch(url.searchParams.get('q'));
    const ORDER_STATUSES = new Set(['pending_payment', 'paid', 'awaiting_supplier', 'submitted_to_supplier', 'supplier_processing', 'dispatched', 'delivered', 'cancelled', 'failed']);
    const PAYMENT_STATUSES = new Set(['pending', 'authorised', 'paid', 'failed', 'refunded', 'partially_refunded', 'cancelled']);
    const status = filterValue(url.searchParams, 'status', ORDER_STATUSES);
    const paymentStatus = filterValue(url.searchParams, 'payment_status', PAYMENT_STATUSES);
    let query = serviceClient().from('orders').select(`id, order_number, email, shipping_name, total_minor, currency, status, payment_status, fulfilment_status, payment_provider, carrier, tracking_number, placed_at, paid_at, dispatched_at`, { count: 'exact' });
    if (status) query = query.eq('status', status);
    if (paymentStatus) query = query.eq('payment_status', paymentStatus);
    if (q) query = query.or(`order_number.ilike.%${q}%,email.ilike.%${q}%,shipping_name.ilike.%${q}%`);
    const { data, count, error } = await query.order('placed_at', { ascending: false }).range(from, to);
    if (error) throw translateDbError(error);
    return ok(res, { items: data ?? [], total: count ?? 0, page, pageSize });
  }
  if (!UUID_RE.test(id)) throw new AppError('INVALID_ORDER', 'Invalid order reference.', 400);
  const db = serviceClient();
  const actor = `admin:${profile.email}`;
  const ALLOWED_STATUSES = ['paid', 'awaiting_supplier', 'submitted_to_supplier', 'supplier_processing', 'dispatched', 'delivered'];
  if (req.method === 'GET') {
    const order = await getOrderById(id);
    const [items, events, payments, supplierOrders] = await Promise.all([
      getOrderItems(id),
      db.from('order_events').select('id, event_type, from_status, to_status, message, actor, metadata, created_at').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
      db.from('payment_transactions').select('id, provider, provider_reference, amount_minor, currency, status, failure_reason, created_at').eq('order_id', id).order('created_at', { ascending: false }),
      db.from('supplier_orders').select('id, supplier_id, external_reference, external_order_id, status, attempts, last_error, carrier, tracking_number, tracking_url, submitted_at, dispatched_at, last_synced_at, created_at').eq('order_id', id).order('created_at', { ascending: false })
    ]);
    return ok(res, { order, items, events: events.data ?? [], payments: payments.data ?? [], supplier_orders: supplierOrders.data ?? [], manual_payment_instructions: manualPaymentInstructions(order.order_number) });
  }
  requireContentTypeJson(req);
  const body = await readBody(req, 64 * 1024);
  if (req.method === 'PATCH') {
    const adminNotes = cleanMultiline(body.admin_notes, { max: 4000 });
    const { error } = await db.from('orders').update({ admin_notes: adminNotes || null }).eq('id', id);
    if (error) throw translateDbError(error);
    const order = await getOrderById(id);
    return ok(res, { order });
  }
  const action = cleanText(body.action, { max: 40 });
  const order = await getOrderById(id);
  if (action === 'mark_paid') {
    if (order.payment_status === 'paid') return ok(res, { already_paid: true });
    const provider = order.payment_provider === 'stripe' ? 'stripe' : 'manual';
    const reference = cleanText(body.reference, { max: 160 });
    if (provider === 'stripe' && !reference) {
      throw new AppError('REFERENCE_REQUIRED', 'Check the Stripe dashboard first, then enter the payment reference.', 400, { field: 'reference' });
    }
    const result = await markOrderPaid({ orderId: order.id, provider, reference: reference || `manual:${order.id}`, amountMinor: order.total_minor, currency: order.currency, raw: { verified_by: profile.email, method: 'admin_verification', note: cleanText(body.note, { max: 300 }), verified_at: new Date().toISOString() } });
    await db.from('order_events').insert({ order_id: order.id, event_type: 'payment_verified_by_admin', message: `Payment verified by ${profile.email}.`, actor });
    return ok(res, { result, provider });
  }
  if (action === 'update_status') {
    const status = cleanText(body.status, { max: 40 });
    if (!ALLOWED_STATUSES.includes(status)) throw new AppError('INVALID_STATUS', 'That status change is not allowed here.', 400, { field: 'status' });
    if (status === 'dispatched') throw new AppError('USE_RECORD_SHIPMENT', 'Record the carrier and tracking number to mark an order dispatched.', 400, { field: 'status' });
    if (status === 'delivered' && !order.tracking_number) throw new AppError('TRACKING_REQUIRED', 'Record dispatch and tracking before marking an order delivered.', 409, { field: 'status' });
    const { data, error } = await db.rpc('admin_update_order_status', { p_order_id: order.id, p_status: status, p_note: cleanText(body.note, { max: 500 }) || null, p_actor: actor });
    if (error) throw translateDbError(error);
    if (status === 'dispatched') await sendDispatchEmail(order.id);
    return ok(res, { result: data });
  }
  if (action === 'cancel') {
    const reason = cleanText(body.reason, { max: 300 });
    if (reason.length < 3) throw new AppError('REASON_REQUIRED', 'Enter a cancellation reason.', 400, { field: 'reason' });
    const { data, error } = await db.rpc('cancel_order', { p_order_id: order.id, p_reason: reason, p_actor: actor });
    if (error) throw translateDbError(error);
    await sendCancellationEmail(order.id, reason);
    return ok(res, { result: data });
  }
  if (action === 'record_shipment') {
    const carrier = cleanText(body.carrier, { max: 80 });
    const trackingNumber = cleanText(body.tracking_number, { max: 120 });
    const trackingUrl = cleanText(body.tracking_url, { max: 500 });
    if (!carrier || !trackingNumber) throw new AppError('TRACKING_REQUIRED', 'Enter the carrier and tracking number.', 400);
    if (trackingUrl && !/^https?:\/\//i.test(trackingUrl)) throw new AppError('INVALID_TRACKING_URL', 'Tracking URL must start with http:// or https://.', 400, { field: 'tracking_url' });
    const { data, error } = await db.rpc('record_shipment', { p_order_id: order.id, p_carrier: carrier, p_tracking_number: trackingNumber, p_tracking_url: trackingUrl || null, p_actor: actor });
    if (error) throw translateDbError(error);
    await sendDispatchEmail(order.id);
    return ok(res, { result: data });
  }
  if (action === 'submit_supplier') {
    if (order.payment_status !== 'paid') throw new AppError('PAYMENT_NOT_CONFIRMED', 'Only paid orders can be sent to the supplier.', 409);
    if (order.status === 'cancelled' || order.status === 'failed') throw new AppError('ORDER_NOT_SUBMITTABLE', 'This order can no longer be submitted.', 409);
    let supplierQuery = db.from('supplier_accounts').select('*').eq('connector', 'aw-dropship');
    supplierQuery = body.supplier_id ? supplierQuery.eq('id', cleanText(body.supplier_id, { max: 64 })) : supplierQuery.eq('is_active', true);
    const { data: supplier, error: supplierError } = await supplierQuery.limit(1).maybeSingle();
    if (supplierError) throw supplierError;
    if (!supplier) throw new AppError('SUPPLIER_NOT_CONFIGURED', 'No active AW Dropship account is configured.', 503);
    const externalOrderId = cleanText(body.external_order_id, { max: 120 });
    const existing = await db.from('supplier_orders').select('id, attempts').eq('order_id', order.id).maybeSingle();
    if (existing.error) throw existing.error;
    const payload = { order_id: order.id, supplier_id: supplier.id, external_reference: order.order_number, external_order_id: externalOrderId || null, status: 'submitted', attempts: Number(existing.data?.attempts ?? 0) + 1, last_error: null, submitted_at: new Date().toISOString(), raw_payload: { manual: true, submitted_by: profile.email, note: cleanText(body.note, { max: 300 }) } };
    if (existing.data?.id) {
      const { error } = await db.from('supplier_orders').update(payload).eq('id', existing.data.id);
      if (error) throw error;
    } else {
      const { error } = await db.from('supplier_orders').insert({ ...payload, idempotency_key: `order:${order.id}` });
      if (error) throw error;
    }
    const { error: statusError } = await db.rpc('admin_update_order_status', { p_order_id: order.id, p_status: 'submitted_to_supplier', p_note: 'Recorded as submitted to AW Dropship (manual submission).', p_actor: actor });
    if (statusError) throw translateDbError(statusError);
    return ok(res, { manual: true, note: 'Recorded as submitted manually. Automated AW submission is not enabled until the payload schema is verified.' });
  }
  if (action === 'sync_supplier') {
    let supplierOrderId = cleanText(body.supplier_order_id, { max: 64 });
    if (!supplierOrderId) {
      const { data: record } = await db.from('supplier_orders').select('id').eq('order_id', order.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      supplierOrderId = record?.id ?? null;
    }
    if (!supplierOrderId) throw new AppError('SUPPLIER_ORDER_NOT_FOUND', 'No supplier record exists for this order.', 404);
    const result = await refreshSupplierOrderStatus(supplierOrderId);
    return ok(res, { result });
  }
  if (action === 'add_note') {
    const note = cleanMultiline(body.note, { max: 2000 });
    if (!note) throw new AppError('NOTE_REQUIRED', 'Enter a note.', 400);
    const { error } = await db.from('order_events').insert({ order_id: order.id, event_type: 'admin_note', message: note, actor });
    if (error) throw error;
    return ok(res, { added: true });
  }
  throw new AppError('INVALID_ACTION', 'That order action is not supported.', 400);
}

async function handleAdminProducts(req, res) {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'POST', 'PATCH', 'DELETE']);
  const segments = pathSegments(req);
  const db = serviceClient();
  if (segments.length >= 1 && segments[0] === 'products' && segments.length === 2) {
    const id = segments[1];
    if (!UUID_RE.test(id)) throw new AppError('INVALID_PRODUCT', 'Invalid product reference.', 400);
    const existing = await loadAdminProduct(db, id);
    if (req.method === 'GET') return ok(res, { product: existing });
    if (req.method === 'DELETE') {
      const { error } = await db.from('products').update({ status: 'archived', archived_at: new Date().toISOString(), is_featured: false }).eq('id', id);
      if (error) throw translateDbError(error);
      return ok(res, { archived: true });
    }
    requireContentTypeJson(req);
    const body = await readBody(req, 256 * 1024);
    const { product, images, categoryIds, variants } = validateProductInput(body, { partial: true });
    const effectivePrice = product.price_minor ?? existing.price_minor;
    const effectiveCompare = product.compare_at_price_minor !== undefined ? product.compare_at_price_minor : existing.compare_at_price_minor;
    if (effectiveCompare !== null && effectiveCompare < effectivePrice) throw new AppError('INVALID_FIELD', 'Compare-at price cannot be lower than the price.', 400, { field: 'compare_at_price_minor' });
    if (product.status === 'active' && !existing.published_at) product.published_at = new Date().toISOString();
    if (product.status === 'archived') product.archived_at = new Date().toISOString();
    if (Object.keys(product).length) {
      const { error } = await db.from('products').update(product).eq('id', id);
      if (error) {
        if (error.code === '23505') throw new AppError('DUPLICATE_PRODUCT', 'A product with that SKU or slug already exists.', 409);
        throw translateDbError(error);
      }
    }
    await replaceImages(db, id, images);
    await replaceCategories(db, id, categoryIds);
    await syncVariants(db, existing, variants);
    const full = await loadAdminProduct(db, id);
    return ok(res, { product: full });
  }
  if (segments.length === 1 && segments[0] === 'products') {
    if (req.method === 'GET') {
      const url = new URL(originalUrl(req), 'http://localhost');
      const { page, pageSize, from, to } = parsePagination(url, { defaultSize: 20, maxSize: 100 });
      const q = sanitiseSearch(url.searchParams.get('q'));
      const status = url.searchParams.get('status');
      const categoryId = url.searchParams.get('category');
      let ids = null;
      if (categoryId) {
        const { data: links, error } = await db.from('product_categories').select('product_id').eq('category_id', categoryId);
        if (error) throw error;
        ids = (links ?? []).map((row) => row.product_id);
        if (!ids.length) return ok(res, { items: [], total: 0, page, pageSize });
      }
      let query = db.from('products').select(`id, sku, slug, name, status, price_minor, compare_at_price_minor, currency, availability, is_featured, is_best_seller, is_new_arrival, sales_count, published_at, updated_at, product_images ( url, is_primary, sort_order ), product_categories ( category_id, categories ( id, name, slug ) )`, { count: 'exact' });
      if (status && ['draft', 'active', 'archived'].includes(status)) query = query.eq('status', status);
      if (ids) query = query.in('id', ids);
      if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,slug.ilike.%${q}%`);
      const { data, count, error } = await query.order('updated_at', { ascending: false }).range(from, to);
      if (error) throw translateDbError(error);
      const primaryImage = (images = []) => { const sorted = [...images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.sort_order ?? 0) - (b.sort_order ?? 0)); return sorted[0]?.url ?? '/assets/products/placeholder.svg'; };
      return ok(res, { items: (data ?? []).map((row) => ({ ...row, primary_image: primaryImage(row.product_images), categories: (row.product_categories ?? []).map((link) => link.categories).filter(Boolean) })), total: count ?? 0, page, pageSize });
    }
    requireContentTypeJson(req);
    const body = await readBody(req, 256 * 1024);
    const { product, images, categoryIds, variants } = validateProductInput(body);
    if (!product.name || !product.sku) throw new AppError('INVALID_FIELD', 'A product needs a name and SKU.', 400);
    if (product.compare_at_price_minor !== undefined && product.compare_at_price_minor !== null && product.compare_at_price_minor < product.price_minor) {
      throw new AppError('INVALID_FIELD', 'Compare-at price cannot be lower than the price.', 400, { field: 'compare_at_price_minor' });
    }
    const insert = { ...product, slug: product.slug || slugify(product.name), brand: product.brand || 'Hasswell London', status: product.status || 'draft', published_at: product.status === 'active' ? new Date().toISOString() : null };
    const { data: created, error } = await db.from('products').insert(insert).select('id').single();
    if (error) {
      if (error.code === '23505') throw new AppError('DUPLICATE_PRODUCT', 'A product with that SKU or slug already exists.', 409);
      throw translateDbError(error);
    }
    try {
      await replaceImages(db, created.id, images);
      await replaceCategories(db, created.id, categoryIds);
      const initial = { id: created.id, product_variants: [] };
      await syncVariants(db, initial, variants);
    } catch (error) {
      await db.from('products').delete().eq('id', created.id);
      throw error;
    }
    const full = await loadAdminProduct(db, created.id);
    return ok(res, { product: full }, 201);
  }
  throw new AppError('NOT_FOUND', 'Not found.', 404);
}

async function handleAdminSettings(req, res) {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'PATCH']);
  const db = serviceClient();
  if (req.method === 'GET') {
    const { data, error } = await db.from('store_settings').select('key, value, is_public, updated_at').order('key', { ascending: true });
    if (error) throw translateDbError(error);
    return ok(res, { items: data ?? [], spec: SETTINGS_SPEC });
  }
  requireContentTypeJson(req);
  const body = await readBody(req, 64 * 1024);
  const settings = validateSettingsInput(body);
  const rows = Object.entries(settings).map(([key, value]) => ({ key, value, is_public: SETTINGS_SPEC[key]?.public ?? false, updated_at: new Date().toISOString() }));
  const { error } = await db.from('store_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw translateDbError(error);
  const { data } = await db.from('store_settings').select('key, value, is_public, updated_at').order('key');
  return ok(res, { items: data ?? [] });
}

async function handleAdminSuppliers(req, res) {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'POST']);
  const db = serviceClient();
  if (req.method === 'GET') {
    const [accounts, logs, products] = await Promise.all([
      db.from('supplier_accounts').select('*').order('created_at'),
      db.from('supplier_sync_logs').select('*').order('started_at', { ascending: false }).limit(20),
      db.from('supplier_products').select('supplier_id, product_id')
    ]);
    if (accounts.error) throw translateDbError(accounts.error);
    const counts = (products.data ?? []).reduce((acc, row) => { acc[row.supplier_id] = acc[row.supplier_id] ?? { products: 0, linked: 0 }; acc[row.supplier_id].products += 1; if (row.product_id) acc[row.supplier_id].linked += 1; return acc; }, {});
    return ok(res, { items: (accounts.data ?? []).map((account) => ({ ...account, counts: counts[account.id] ?? { products: 0, linked: 0 }, runtime: { token_configured: Boolean(env('AW_DROPSHIP_API_TOKEN')), base_url: env('AW_DROPSHIP_BASE_URL') || account.api_base_url, order_submission_enabled: env('AW_DROPSHIP_ORDER_SUBMISSION_ENABLED', 'false') === 'true', order_submission_verified: false, manual_submission_required: true } })), logs: logs.data ?? [] });
  }
  requireContentTypeJson(req);
  const body = await readBody(req, 32 * 1024);
  const action = cleanText(body.action, { max: 40 });
  const { data: account, error } = await db.from('supplier_accounts').select('*').eq('id', cleanText(body.supplier_id, { max: 64 })).maybeSingle();
  if (error) throw translateDbError(error);
  if (!account) throw new AppError('SUPPLIER_NOT_FOUND', 'That supplier account could not be found.', 404);
  if (action === 'test') {
    const connector = createSupplierConnector(account);
    const products = await connector.fetchCatalogue();
    return ok(res, { connected: true, products_found: products.length, sample: products.slice(0, 5).map((row) => ({ sku: row.supplierSku, name: row.name, stock: row.stock })), wrote_data: false, note: 'Read-only connection test. No catalogue or stock data was written.' });
  }
  if (action === 'sync') {
    const result = await syncSupplier({ supplierId: account.id, createMissingProducts: asBoolean(body.create_missing_products) });
    return ok(res, { result });
  }
  if (action === 'toggle') {
    const isActive = asBoolean(body.is_active);
    const { error: updateError } = await db.from('supplier_accounts').update({ is_active: isActive }).eq('id', account.id);
    if (updateError) throw updateError;
    return ok(res, { is_active: isActive });
  }
  if (action === 'update') {
    const update = {};
    if (body.name !== undefined) { update.name = cleanText(body.name, { max: 120 }); if (!update.name) throw new AppError('INVALID_SUPPLIER', 'Enter a supplier name.', 400); }
    if (body.api_base_url !== undefined) { const baseUrl = cleanText(body.api_base_url, { max: 300 }); if (baseUrl && !/^https:\/\//i.test(baseUrl)) throw new AppError('INVALID_SUPPLIER', 'Supplier base URL must use https.', 400); update.api_base_url = baseUrl || null; }
    if (body.notes !== undefined) update.notes = cleanText(body.notes, { max: 1000 }) || null;
    if (body.credentials_ref !== undefined) { const ref = cleanText(body.credentials_ref, { max: 80 }); if (ref && !/^[A-Z0-9_]+$/.test(ref)) throw new AppError('INVALID_SUPPLIER', 'Credentials reference must be an environment variable name.', 400); update.credentials_ref = ref || null; }
    if (!Object.keys(update).length) throw new AppError('INVALID_SUPPLIER', 'No changes were provided.', 400);
    const { error: updateError } = await db.from('supplier_accounts').update(update).eq('id', account.id);
    if (updateError) throw updateError;
    return ok(res, { updated: true });
  }
  throw new AppError('INVALID_ACTION', 'That supplier action is not supported.', 400);
}

async function handleCronSyncSupplier(req, res) {
  assertMethod(req, ['GET', 'POST']);
  const secret = env('CRON_SECRET');
  if (!secret) throw new AppError('CRON_NOT_CONFIGURED', 'CRON_SECRET is not configured.', 503);
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw new AppError('UNAUTHORISED', 'Cron authorisation failed.', 401);
  const provided = Buffer.from(header.slice(7).trim());
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new AppError('UNAUTHORISED', 'Cron authorisation failed.', 401);
  const url = new URL(originalUrl(req), 'http://localhost');
  const createMissing = url.searchParams.get('create_missing_products') === '1';
  let supplier = null;
  let supplierError = null;
  try { supplier = await syncSupplier({ createMissingProducts: createMissing }); } catch (error) { supplierError = { code: error?.code || 'SUPPLIER_SYNC_FAILED', message: error?.message || 'Sync failed.' }; console.error('[cron] supplier sync failed:', error?.message || error); }
  const db = serviceClient();
  let released = 0;
  try { const { data, error } = await db.rpc('release_expired_orders', { p_hours: 24 }); if (error) throw error; released = Number(data ?? 0); } catch (error) { console.error('[cron] release expired orders failed:', error?.message || error); }
  let pruned = false;
  try { const { error } = await db.rpc('prune_operational_tables'); pruned = !error; } catch (error) { console.error('[cron] prune failed:', error?.message || error); }
  return ok(res, { supplier, supplier_error: supplierError, released_orders: released, pruned });
}

/* ========================================================================
   Helpers
   ======================================================================== */

function timingSafeEqual(a, b) {
  try { return createHash('sha256').update(a).digest() === createHash('sha256').update(b).digest(); } catch { return false; }
}

function randomUUID() {
  return createHash('sha256').update(String(Date.now()) + Math.random()).digest('hex');
}

function contactNotificationEmail({ message, siteUrl }) {
  const subject = `New contact message: ${message.subject}`;
  const html = `<h2>New contact message from Hasswell London</h2><p><strong>Name:</strong> ${escapeHtml(message.name)}</p><p><strong>Email:</strong> ${escapeHtml(message.email)}</p><p><strong>Subject:</strong> ${escapeHtml(message.subject)}</p><p><strong>Message:</strong><br>${escapeHtml(message.message).replace(/\n/g, '<br>')}</p>`;
  const text = `New contact message from Hasswell London\n\nName: ${message.name}\nEmail: ${message.email}\nSubject: ${message.subject}\nMessage:\n${message.message}`;
  return { subject, html, text, replyTo: message.email };
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/* ========================================================================
   Route table
   ======================================================================== */

const ROUTES = [
  { methods: ['GET'], path: '/health', handler: handleHealth },
  { methods: ['GET'], path: '/robots', handler: handleRobots },
  { methods: ['GET'], path: '/sitemap', handler: handleSitemap },
  { methods: ['GET'], path: '/store/config', handler: handleStoreConfig },
  { methods: ['POST'], path: '/contact', handler: handleContact },
  { methods: ['POST'], path: '/newsletter', handler: handleNewsletter },
  { methods: ['POST'], path: '/cart/validate', handler: handleCartValidate },
  { methods: ['POST'], path: '/checkout/create-order', handler: handleCheckoutCreateOrder },
  { methods: ['POST'], path: '/checkout/retry-payment', handler: handleCheckoutRetryPayment },
  { methods: ['GET'], path: '/orders/status', handler: handleOrdersStatus },
  { methods: ['POST'], path: '/payments/webhook', handler: handlePaymentsWebhook },
  { methods: ['GET'], path: '/admin/dashboard', handler: handleAdminDashboard },
  { methods: ['GET'], path: '/admin/email-log', handler: handleAdminEmailLog },
  { methods: ['GET'], path: '/admin/newsletter', handler: handleAdminNewsletter },
  { methods: ['GET', 'POST'], path: '/admin/categories', handler: handleAdminCategories },
  { methods: ['GET', 'POST', 'PATCH', 'DELETE'], path: '/admin/categories/:id', handler: handleAdminCategories },
  { methods: ['GET', 'POST'], path: '/admin/inventory', handler: handleAdminInventory },
  { methods: ['GET', 'PATCH'], path: '/admin/messages', handler: handleAdminMessages },
  { methods: ['GET'], path: '/admin/orders', handler: handleAdminOrders },
  { methods: ['GET', 'PATCH', 'POST'], path: '/admin/orders/:id', handler: handleAdminOrders },
  { methods: ['GET', 'POST', 'PATCH', 'DELETE'], path: '/admin/products', handler: handleAdminProducts },
  { methods: ['GET', 'POST', 'PATCH', 'DELETE'], path: '/admin/products/:id', handler: handleAdminProducts },
  { methods: ['GET', 'PATCH'], path: '/admin/settings', handler: handleAdminSettings },
  { methods: ['GET', 'POST'], path: '/admin/suppliers', handler: handleAdminSuppliers },
  { methods: ['GET', 'POST'], path: '/cron/sync-supplier', handler: handleCronSyncSupplier }
];

function matchRoute(segments, method) {
  for (const route of ROUTES) {
    const routeSegments = route.path.split('/').filter(Boolean);
    if (routeSegments.length !== segments.length) continue;
    let matched = true;
    const params = {};
    for (let i = 0; i < routeSegments.length; i++) {
      const routePart = routeSegments[i];
      const reqPart = segments[i];
      if (routePart.startsWith(':')) {
        params[routePart.slice(1)] = reqPart;
      } else if (routePart !== reqPart) {
        matched = false;
        break;
      }
    }
    if (matched && route.methods.includes(method)) return { route, params };
  }
  return null;
}

/* ========================================================================
   Entry point
   ======================================================================== */

export default handler(async (req, res) => {
  const segments = pathSegments(req);
  const match = matchRoute(segments, req.method);
  if (!match) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } }));
    return;
  }
  await match.route.handler(req, res);
});
