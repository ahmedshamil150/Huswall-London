import { serviceClient } from './supabase.js';
import { AppError } from './http.js';

/**
 * Server-side cart resolution.
 *
 * Prices and availability always come from the database. Requested quantities
 * are clamped to real availability and every adjustment is reported so the
 * storefront can ask the customer to review their bag.
 */

const PRODUCT_SELECT = `
  id, sku, slug, name, status, price_minor, currency,
  product_images ( url, is_primary, sort_order ),
  product_variants ( id, sku, name, price_minor, is_active, availability )
`;

function inventoryKey(productId, variantId) {
  return `${productId}:${variantId ?? 'base'}`;
}

function primaryImage(product) {
  const images = [...(product.product_images ?? [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  return images[0]?.url || '/assets/products/placeholder.svg';
}

export async function resolveCart(requestedItems) {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    throw new AppError('CART_EMPTY', 'Your bag is empty.', 400);
  }

  const db = serviceClient();
  const productIds = [...new Set(requestedItems.map((item) => item.product_id))];

  const [{ data: products, error: productError }, { data: inventory, error: inventoryError }] =
    await Promise.all([
      db.from('products').select(PRODUCT_SELECT).in('id', productIds),
      db
        .from('inventory')
        .select('product_id, variant_id, stock_on_hand, stock_reserved')
        .in('product_id', productIds)
    ]);

  if (productError) throw productError;
  if (inventoryError) throw inventoryError;

  const productsById = new Map((products ?? []).map((row) => [row.id, row]));
  const inventoryByKey = new Map(
    (inventory ?? []).map((row) => [inventoryKey(row.product_id, row.variant_id), row])
  );

  const items = [];
  const issues = [];
  let removedCount = 0;

  for (const request of requestedItems) {
    const product = productsById.get(request.product_id);

    if (!product || product.status !== 'active') {
      removedCount += 1;
      issues.push({
        code: 'PRODUCT_UNAVAILABLE',
        product_id: request.product_id,
        message: 'An item in your bag is no longer available and was removed.'
      });
      continue;
    }

    const activeVariants = (product.product_variants ?? []).filter((variant) => variant.is_active);
    let variant = null;

    if (activeVariants.length) {
      variant = request.variant_id
        ? activeVariants.find((entry) => entry.id === request.variant_id) ?? null
        : null;

      if (!variant) {
        removedCount += 1;
        issues.push({
          code: 'VARIANT_UNAVAILABLE',
          product_id: product.id,
          message: `Choose an available option for ${product.name}.`
        });
        continue;
      }
    } else if (request.variant_id) {
      removedCount += 1;
      issues.push({
        code: 'VARIANT_UNAVAILABLE',
        product_id: product.id,
        message: `${product.name} no longer has that option.`
      });
      continue;
    }

    const inv = inventoryByKey.get(inventoryKey(product.id, variant?.id ?? null));
    const available = inv ? Math.max(0, inv.stock_on_hand - inv.stock_reserved) : 0;

    if (available <= 0) {
      removedCount += 1;
      issues.push({
        code: 'OUT_OF_STOCK',
        product_id: product.id,
        variant_id: variant?.id ?? null,
        message: `${product.name}${variant ? ` — ${variant.name}` : ''} is out of stock and was removed.`
      });
      continue;
    }

    const quantity = Math.min(request.quantity, available);
    if (quantity < request.quantity) {
      issues.push({
        code: 'QUANTITY_REDUCED',
        product_id: product.id,
        variant_id: variant?.id ?? null,
        message: `Only ${available} of ${product.name}${variant ? ` — ${variant.name}` : ''} remain. Your quantity was adjusted.`
      });
    }

    const unitPrice = variant ? variant.price_minor : product.price_minor;

    items.push({
      product_id: product.id,
      variant_id: variant?.id ?? null,
      sku: variant?.sku ?? product.sku,
      slug: product.slug,
      name: product.name,
      variant_name: variant?.name ?? null,
      unit_price_minor: unitPrice,
      quantity,
      line_total_minor: unitPrice * quantity,
      available,
      image: primaryImage(product)
    });
  }

  const subtotalMinor = items.reduce((sum, item) => sum + item.line_total_minor, 0);

  return {
    items,
    subtotal_minor: subtotalMinor,
    issues,
    removed_count: removedCount
  };
}
