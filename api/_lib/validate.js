import { AppError } from './http.js';

/**
 * Server-side validation and normalisation.
 *
 * The browser performs its own checks for a good experience, but every value
 * that reaches the database is validated here as well. Nothing is trusted.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]{2,}$/;
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function normaliseEmail(value) {
  return cleanText(value, { max: 254, multiline: false }).toLowerCase();
}

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
}

/**
 * Removes control characters, normalises whitespace and enforces a maximum
 * length. It intentionally does not HTML-escape: rendering always escapes.
 */
export function cleanText(value, { max = 500, multiline = false } = {}) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (multiline) {
    text = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    text = text
      .split('\n')
      .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    text = text.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return text.slice(0, max);
}

export function cleanMultiline(value, { max = 2000 } = {}) {
  return cleanText(value, { max, multiline: true });
}

export function asInt(value, { min = -Infinity, max = Infinity, fallback = null } = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) return fallback;
  if (number < min || number > max) return fallback;
  return number;
}

export function asBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return false;
}

export function normaliseCountry(value) {
  const code = cleanText(value, { max: 2 }).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : 'GB';
}

export function normalisePostcode(value) {
  return cleanText(value, { max: 20 }).toUpperCase().replace(/\s+/g, ' ');
}

export function validateIdempotencyKey(value) {
  const key = cleanText(value, { max: 128 });
  if (!key) return null;
  return IDEMPOTENCY_RE.test(key) ? key : null;
}

/**
 * Cart lines are reduced to identifiers and quantities. Prices are never
 * accepted from the client.
 */
export function validateCartItems(rawItems, { maxLines = 40 } = {}) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new AppError('CART_EMPTY', 'Your bag is empty.', 400);
  }
  if (rawItems.length > maxLines) {
    throw new AppError('CART_TOO_LARGE', 'Your bag contains too many different items.', 400);
  }

  const byKey = new Map();
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') {
      throw new AppError('INVALID_CART', 'Your bag contains an invalid item.', 400);
    }
    const productId = raw.product_id;
    const variantId = raw.variant_id || null;
    const quantity = asInt(raw.quantity, { min: 1, max: 99 });

    if (!isUuid(productId)) {
      throw new AppError('INVALID_CART', 'Your bag contains an invalid item.', 400);
    }
    if (variantId !== null && !isUuid(variantId)) {
      throw new AppError('INVALID_CART', 'Your bag contains an invalid item option.', 400);
    }
    if (quantity === null) {
      throw new AppError('INVALID_QUANTITY', 'Check the quantities in your bag.', 400);
    }

    const key = `${productId}:${variantId ?? 'base'}`;
    const existing = byKey.get(key);
    if (existing) existing.quantity = Math.min(existing.quantity + quantity, 99);
    else byKey.set(key, { product_id: productId, variant_id: variantId, quantity });
  }

  return [...byKey.values()];
}

export function validateCheckoutInput(body, { allowedCountries = ['GB'] } = {}) {
  if (!body || typeof body !== 'object') {
    throw new AppError('INVALID_REQUEST', 'Checkout details were not provided.', 400);
  }

  if (body.terms_accepted !== true) {
    throw new AppError('TERMS_NOT_ACCEPTED', 'Please accept the terms to place your order.', 400);
  }

  const items = validateCartItems(body.items);
  const raw = body.customer && typeof body.customer === 'object' ? body.customer : {};

  const email = normaliseEmail(raw.email);
  if (!isEmail(email)) {
    throw new AppError('INVALID_EMAIL', 'Enter a valid email address.', 400, { field: 'email' });
  }

  const phone = cleanText(raw.phone, { max: 32 });
  if (phone.replace(/\D/g, '').length < 7) {
    throw new AppError('INVALID_PHONE', 'Enter a phone number so the courier can reach you.', 400, {
      field: 'phone'
    });
  }

  const shippingName = cleanText(raw.shipping_name, { max: 120 });
  if (shippingName.length < 2) {
    throw new AppError('INVALID_NAME', 'Enter the recipient’s full name.', 400, { field: 'shipping_name' });
  }

  const shippingLine1 = cleanText(raw.shipping_line1, { max: 160 });
  const shippingLine2 = cleanText(raw.shipping_line2, { max: 160 });
  const shippingCity = cleanText(raw.shipping_city, { max: 100 });
  const shippingRegion = cleanText(raw.shipping_region, { max: 100 });
  const postcode = normalisePostcode(raw.shipping_postcode);
  const country = normaliseCountry(raw.shipping_country);

  if (!shippingLine1 || !shippingCity || !postcode) {
    throw new AppError('INVALID_ADDRESS', 'Enter a complete delivery address.', 400);
  }

  if (country === 'GB' && !UK_POSTCODE_RE.test(postcode.replace(/\s+/g, ''))) {
    throw new AppError('INVALID_POSTCODE', 'Enter a valid UK postcode.', 400, {
      field: 'shipping_postcode'
    });
  }

  const allowed = Array.isArray(allowedCountries) && allowedCountries.length ? allowedCountries : ['GB'];
  if (!allowed.includes(country)) {
    throw new AppError('UNSUPPORTED_COUNTRY', 'We do not currently deliver to that country.', 400, {
      field: 'shipping_country'
    });
  }

  const deliveryNotes = cleanMultiline(raw.delivery_notes ?? body.delivery_notes, { max: 500 });
  const customerNotes = cleanMultiline(body.customer_notes, { max: 1000 });

  return {
    items,
    customer: {
      email,
      phone,
      shipping_name: shippingName,
      shipping_line1: shippingLine1,
      shipping_line2: shippingLine2,
      shipping_city: shippingCity,
      shipping_region: shippingRegion,
      shipping_postcode: postcode,
      shipping_country: country,
      delivery_notes: deliveryNotes,
      accepts_marketing: asBoolean(raw.accepts_marketing)
    },
    delivery_notes: deliveryNotes,
    customer_notes: customerNotes
  };
}

export function validateContactInput(body) {
  if (!body || typeof body !== 'object') {
    throw new AppError('INVALID_REQUEST', 'Message details were not provided.', 400);
  }
  const name = cleanText(body.name, { max: 120 });
  const email = normaliseEmail(body.email);
  const subject = cleanText(body.subject, { max: 160 });
  const message = cleanMultiline(body.message, { max: 4000 });

  if (name.length < 2) throw new AppError('INVALID_NAME', 'Enter your name.', 400, { field: 'name' });
  if (!isEmail(email)) throw new AppError('INVALID_EMAIL', 'Enter a valid email address.', 400, { field: 'email' });
  if (message.length < 10) {
    throw new AppError('MESSAGE_TOO_SHORT', 'Please add a little more detail to your message.', 400, {
      field: 'message'
    });
  }

  return { name, email, subject: subject || 'Website enquiry', message };
}

export function validateNewsletterInput(body, { allowedSources = ['storefront', 'footer', 'popup'] } = {}) {
  const email = normaliseEmail(body?.email);
  if (!isEmail(email)) {
    throw new AppError('INVALID_EMAIL', 'Enter a valid email address.', 400, { field: 'email' });
  }
  const source = cleanText(body?.source, { max: 40 }) || 'website';
  return { email, source: allowedSources.includes(source) ? source : 'website' };
}
