import { AppError } from './http.js';
import { cleanText, cleanMultiline, asInt, asBoolean } from './validate.js';

/**
 * Admin-only request helpers and payload validation.
 * Every admin endpoint calls requireAdmin() before touching the database.
 */

export function parsePagination(url, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = Math.max(1, asInt(url.searchParams.get('page'), { min: 1, max: 100000, fallback: 1 }));
  const pageSize = Math.min(
    maxSize,
    Math.max(1, asInt(url.searchParams.get('pageSize'), { min: 1, max: maxSize, fallback: defaultSize }))
  );
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function cleanSlug(value, fallback = '') {
  const slug = slugify(value || fallback);
  if (!slug) throw new AppError('INVALID_SLUG', 'Enter a valid URL slug.', 400, { field: 'slug' });
  return slug;
}

function optionalInt(value, { min = 0, max = 100000000, field }) {
  if (value === null || value === undefined || value === '') return null;
  const number = asInt(value, { min, max, fallback: null });
  if (number === null) {
    throw new AppError('INVALID_FIELD', `Enter a valid value for ${field}.`, 400, { field });
  }
  return number;
}

function imageUrl(value) {
  const url = cleanText(value, { max: 800 });
  if (!url) return null;
  if (url.startsWith('/')) return url;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function validateImages(raw, { max = 12 } = {}) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new AppError('INVALID_IMAGES', 'Images must be a list.', 400);
  if (raw.length > max) throw new AppError('INVALID_IMAGES', `Use at most ${max} images.`, 400);

  const images = raw
    .map((image, index) => {
      const url = imageUrl(image?.url);
      if (!url) return null;
      return {
        url,
        alt: cleanText(image?.alt, { max: 250 }) || null,
        sort_order: asInt(image?.sort_order, { min: 0, max: 999, fallback: index }) ?? index,
        is_primary: asBoolean(image?.is_primary)
      };
    })
    .filter(Boolean);

  if (images.length && !images.some((image) => image.is_primary)) images[0].is_primary = true;
  let primarySeen = false;
  for (const image of images) {
    if (image.is_primary && primarySeen) image.is_primary = false;
    if (image.is_primary) primarySeen = true;
  }
  return images;
}

export function validateCategoryIds(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new AppError('INVALID_CATEGORIES', 'Categories must be a list.', 400);
  const ids = [...new Set(raw.map((id) => String(id)))];
  for (const id of ids) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new AppError('INVALID_CATEGORIES', 'One of the selected categories is invalid.', 400);
    }
  }
  return ids;
}

export function validateVariants(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new AppError('INVALID_VARIANTS', 'Options must be a list.', 400);
  if (raw.length > 50) throw new AppError('INVALID_VARIANTS', 'Too many product options.', 400);

  return raw.map((variant, index) => {
    const sku = cleanText(variant?.sku, { max: 80 });
    const name = cleanText(variant?.name, { max: 120 });
    const price = optionalInt(variant?.price_minor, { field: 'option price' });
    if (!sku) throw new AppError('INVALID_VARIANTS', 'Each option needs a SKU.', 400);
    if (!name) throw new AppError('INVALID_VARIANTS', 'Each option needs a name.', 400);
    if (price === null) throw new AppError('INVALID_VARIANTS', 'Each option needs a price.', 400);

    return {
      id: variant?.id || null,
      sku,
      name,
      price_minor: price,
      compare_at_price_minor: optionalInt(variant?.compare_at_price_minor, { field: 'compare-at price' }),
      options:
        variant?.options && typeof variant.options === 'object' && !Array.isArray(variant.options)
          ? variant.options
          : {},
      is_active: variant?.is_active === undefined ? true : asBoolean(variant.is_active),
      sort_order: asInt(variant?.sort_order, { min: 0, max: 999, fallback: index }) ?? index
    };
  });
}

export function validateProductInput(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object') {
    throw new AppError('INVALID_REQUEST', 'Product details were not provided.', 400);
  }

  const out = {};

  const assignString = (key, value, { max, field = key, required = false } = {}) => {
    if (value === undefined && partial) return;
    const text = cleanText(value, { max });
    if (required && !text) {
      throw new AppError('INVALID_FIELD', `Enter a value for ${field}.`, 400, { field: key });
    }
    out[key] = text || null;
  };

  if (!partial || body.name !== undefined) {
    assignString('name', body.name, { max: 200, field: 'name', required: true });
  }
  if (!partial || body.sku !== undefined) {
    assignString('sku', body.sku, { max: 80, field: 'SKU', required: true });
  }
  if (body.slug !== undefined) out.slug = cleanSlug(body.slug, body.name);
  if (body.brand !== undefined) out.brand = cleanText(body.brand, { max: 120 }) || 'Hasswell London';
  if (body.short_description !== undefined) out.short_description = cleanText(body.short_description, { max: 400 }) || null;
  if (body.description !== undefined) out.description = cleanMultiline(body.description, { max: 12000 }) || null;

  if (!partial || body.price_minor !== undefined) {
    const price = optionalInt(body.price_minor, { field: 'price' });
    if (price === null) throw new AppError('INVALID_FIELD', 'Enter a price.', 400, { field: 'price_minor' });
    out.price_minor = price;
  }
  if (body.compare_at_price_minor !== undefined) {
    out.compare_at_price_minor = optionalInt(body.compare_at_price_minor, { field: 'compare-at price' });
    if (out.compare_at_price_minor !== null && out.compare_at_price_minor < (out.price_minor ?? 0)) {
      throw new AppError('INVALID_FIELD', 'Compare-at price cannot be lower than the price.', 400, {
        field: 'compare_at_price_minor'
      });
    }
  }

  if (body.status !== undefined) {
    if (!['draft', 'active', 'archived'].includes(body.status)) {
      throw new AppError('INVALID_FIELD', 'Choose a valid product status.', 400, { field: 'status' });
    }
    out.status = body.status;
  }

  for (const key of ['is_featured', 'is_best_seller', 'is_new_arrival']) {
    if (body[key] !== undefined) out[key] = asBoolean(body[key]);
  }

  if (body.weight_grams !== undefined) {
    out.weight_grams = optionalInt(body.weight_grams, { min: 0, max: 100000, field: 'weight' });
  }
  if (body.meta_title !== undefined) out.meta_title = cleanText(body.meta_title, { max: 160 }) || null;
  if (body.meta_description !== undefined) out.meta_description = cleanText(body.meta_description, { max: 320 }) || null;

  const images = validateImages(body.images);
  const categoryIds = validateCategoryIds(body.category_ids);
  const variants = validateVariants(body.variants);

  if (Object.prototype.hasOwnProperty.call(out, 'brand') && out.brand === null) out.brand = 'Hasswell London';

  return { product: out, images, categoryIds, variants };
}

/** Store settings that admin may change. */
export const SETTINGS_SPEC = {
  'store.name': { type: 'string', max: 120, public: true },
  'store.tagline': { type: 'string', max: 200, public: true },
  'store.email': { type: 'email', max: 254, public: true },
  'store.phone': { type: 'string', max: 40, public: true },
  'store.address': { type: 'string', max: 300, public: true },
  'store.currency': { type: 'currency', public: true },
  'store.announcement': { type: 'string', max: 200, public: true },
  'store.social.instagram': { type: 'string', max: 300, public: true },
  'shipping.flat_rate_minor': { type: 'int', min: 0, max: 100000, public: true },
  'shipping.free_threshold_minor': { type: 'int', min: 0, max: 1000000, public: true },
  'shipping.estimate': { type: 'string', max: 200, public: true },
  'shipping.regions': { type: 'regions', public: true },
  'shipping.returns_window_days': { type: 'int', min: 0, max: 365, public: true },
  'legal.company_number': { type: 'string', max: 40, public: true },
  'legal.vat_number': { type: 'string', max: 40, public: true }
};

export function validateSettingsInput(body) {
  const raw = body?.settings;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('INVALID_SETTINGS', 'Settings payload is invalid.', 400);
  }

  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const spec = SETTINGS_SPEC[key];
    if (!spec) continue;

    if (spec.type === 'string') {
      out[key] = cleanText(value, { max: spec.max });
    } else if (spec.type === 'email') {
      const email = cleanText(value, { max: spec.max }).toLowerCase();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new AppError('INVALID_SETTINGS', 'Enter a valid store email address.', 400, { field: key });
      }
      out[key] = email;
    } else if (spec.type === 'currency') {
      const currency = cleanText(value, { max: 10 }).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new AppError('INVALID_SETTINGS', 'Currency must be a 3-letter code.', 400, { field: key });
      }
      out[key] = currency;
    } else if (spec.type === 'int') {
      const number = asInt(value, { min: spec.min, max: spec.max, fallback: null });
      if (number === null) {
        throw new AppError('INVALID_SETTINGS', `Enter a valid number for ${key}.`, 400, { field: key });
      }
      out[key] = number;
    } else if (spec.type === 'regions') {
      if (!Array.isArray(value)) {
        throw new AppError('INVALID_SETTINGS', 'Delivery regions must be a list.', 400, { field: key });
      }
      const regions = [...new Set(value.map((code) => String(code).trim().toUpperCase()))].filter((code) =>
        /^[A-Z]{2}$/.test(code)
      );
      if (!regions.length) {
        throw new AppError('INVALID_SETTINGS', 'Choose at least one delivery region.', 400, { field: key });
      }
      out[key] = regions;
    }
  }

  if (!Object.keys(out).length) {
    throw new AppError('INVALID_SETTINGS', 'No valid settings were provided.', 400);
  }

  return out;
}
