/**
 * AW Dropship payload mapper.
 *
 * The JSON feed's exact row shape is not guaranteed across workspace
 * configurations, so extraction is deliberately tolerant. Anything that cannot
 * be identified by SKU is skipped rather than guessed.
 *
 * Prices: AW catalogue prices are retail figures in major units. A field named
 * *price_minor is treated as integer pence; generic price fields are parsed as
 * decimal pounds. This is documented in docs/aw-dropship.md.
 */

const LIST_KEYS = ['data', 'products', 'items', 'results', 'result', 'my_products', 'myProducts', 'records'];

export function extractRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  for (const key of LIST_KEYS) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  // Some feeds nest the list one level deeper.
  for (const key of LIST_KEYS) {
    const value = payload[key];
    if (value && typeof value === 'object') {
      const nested = extractRows(value);
      if (nested.length) return nested;
    }
  }

  return [];
}

function first(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function toInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.round(number));
}

export function parseMajorUnits(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value * 100));
  const cleaned = String(value).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : null;
}

function parsePriceMinor(row, minorKeys, majorKeys) {
  const explicitMinor = first(row, minorKeys);
  if (explicitMinor !== undefined) return toInteger(explicitMinor);
  const major = first(row, majorKeys);
  return parseMajorUnits(major);
}

function normaliseAvailability(value, stock) {
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim().toLowerCase();
    if (/(out|unavailable|sold|0)/.test(text)) return 'out_of_stock';
    if (/(pre|back)/.test(text)) return 'preorder';
    if (/(low|few)/.test(text)) return 'low_stock';
    if (/(in|available|stock)/.test(text)) return 'in_stock';
  }
  if (typeof stock === 'number') return stock > 0 ? 'in_stock' : 'out_of_stock';
  return null;
}

export function normaliseProductRow(row) {
  if (!row || typeof row !== 'object') return null;

  const sku = String(
    first(row, ['supplier_sku', 'supplierSku', 'sku', 'SKU', 'product_code', 'productCode', 'code']) ?? ''
  ).trim();
  if (!sku) return null;

  const name = String(first(row, ['name', 'title', 'product_name', 'productName', 'description']) ?? sku).trim();
  const stock = toInteger(
    first(row, [
      'stock',
      'stock_level',
      'stockLevel',
      'stock_quantity',
      'stockQuantity',
      'quantity',
      'qty',
      'available',
      'available_quantity',
      'availableQuantity'
    ])
  );
  const availabilityText = first(row, ['availability', 'stock_status', 'stockStatus', 'status', 'in_stock', 'inStock']);

  return {
    supplierSku: sku,
    supplierProductId: first(row, ['supplier_product_id', 'supplierProductId', 'product_id', 'productId', 'id'])
      ? String(first(row, ['supplier_product_id', 'supplierProductId', 'product_id', 'productId', 'id']))
      : null,
    name: name.slice(0, 300),
    priceMinor: parsePriceMinor(
      row,
      ['price_minor', 'priceMinor', 'trade_price_minor', 'tradePriceMinor', 'cost_minor'],
      ['trade_price', 'tradePrice', 'price', 'cost', 'wholesale_price', 'wholesalePrice']
    ),
    rrpMinor: parsePriceMinor(
      row,
      ['rrp_minor', 'rrpMinor', 'retail_price_minor', 'retailPriceMinor'],
      ['rrp', 'retail_price', 'retailPrice', 'recommended_retail_price']
    ),
    stock,
    availability: normaliseAvailability(availabilityText, stock),
    raw: row
  };
}

export function normaliseFeed(payload) {
  const rows = extractRows(payload);
  const products = [];
  const seen = new Set();

  for (const row of rows) {
    const normalised = normaliseProductRow(row);
    if (!normalised) continue;
    const key = normalised.supplierSku.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    products.push(normalised);
  }

  return products;
}

/** Maps AW order status text onto our supplier_order_status enum. */
export function mapOrderStatus(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('dispatch')) return 'dispatched';
  if (text.includes('delivered')) return 'delivered';
  if (text.includes('cancel')) return 'cancelled';
  if (text.includes('fail') || text.includes('error')) return 'failed';
  if (text.includes('pack') || text.includes('pick') || text.includes('warehouse') || text.includes('final'))
    return 'processing';
  if (text.includes('submit')) return 'submitted';
  return 'pending';
}

export function extractTracking(payload) {
  const row = payload?.order ?? payload?.data ?? payload ?? {};
  const number = first(row, ['tracking_number', 'trackingNumber', 'tracking_no', 'trackingNo', 'consignment_number']);
  const carrier = first(row, ['carrier', 'courier', 'shipping_carrier', 'shippingCarrier']);
  const url = first(row, ['tracking_url', 'trackingUrl', 'tracking_link', 'trackingLink']);
  return {
    number: number ? String(number) : null,
    carrier: carrier ? String(carrier) : null,
    url: url ? String(url) : null
  };
}
