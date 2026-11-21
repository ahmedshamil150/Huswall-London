import { AppError } from './http.js';

/**
 * Product persistence helpers used by admin create/update endpoints.
 * Variants are deactivated rather than deleted so historical order lines and
 * inventory movements keep valid references.
 */

const FULL_SELECT = `
  *,
  product_images ( id, url, alt, sort_order, is_primary ),
  product_categories ( category_id, categories ( id, name, slug ) ),
  product_variants ( id, sku, name, options, price_minor, compare_at_price_minor, availability, is_active, sort_order ),
  inventory ( id, variant_id, stock_on_hand, stock_reserved, low_stock_threshold, supplier_stock, last_synced_at ),
  supplier_products ( id, supplier_id, supplier_sku, supplier_price_minor, supplier_stock, supplier_availability, last_synced_at )
`;

export async function loadAdminProduct(db, id) {
  const { data, error } = await db.from('products').select(FULL_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('PRODUCT_NOT_FOUND', 'That product could not be found.', 404);
  return data;
}

export async function replaceImages(db, productId, images) {
  if (images === undefined) return;
  const { error: deleteError } = await db.from('product_images').delete().eq('product_id', productId);
  if (deleteError) throw deleteError;
  if (!images.length) return;
  const { error } = await db.from('product_images').insert(
    images.map((image) => ({
      product_id: productId,
      url: image.url,
      alt: image.alt,
      sort_order: image.sort_order,
      is_primary: image.is_primary
    }))
  );
  if (error) throw error;
}

export async function replaceCategories(db, productId, categoryIds) {
  if (categoryIds === undefined) return;
  const { error: deleteError } = await db
    .from('product_categories')
    .delete()
    .eq('product_id', productId);
  if (deleteError) throw deleteError;
  if (!categoryIds.length) return;
  const { error } = await db
    .from('product_categories')
    .insert(categoryIds.map((categoryId) => ({ product_id: productId, category_id: categoryId })));
  if (error) throw error;
}

async function ensureInventoryRow(db, productId, variantId) {
  let query = db.from('inventory').select('id').eq('product_id', productId);
  query = variantId ? query.eq('variant_id', variantId) : query.is('variant_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (data) return;
  const { error: insertError } = await db
    .from('inventory')
    .insert({ product_id: productId, variant_id: variantId });
  if (insertError && insertError.code !== '23505') throw insertError;
}

export async function syncVariants(db, product, variants) {
  if (variants === undefined) return;

  const existing = product.product_variants ?? [];
  const existingById = new Map(existing.map((variant) => [variant.id, variant]));
  const keep = new Set();

  for (const variant of variants) {
    const payload = {
      product_id: product.id,
      sku: variant.sku,
      name: variant.name,
      options: variant.options,
      price_minor: variant.price_minor,
      compare_at_price_minor: variant.compare_at_price_minor,
      is_active: variant.is_active,
      sort_order: variant.sort_order
    };

    if (variant.id && existingById.has(variant.id)) {
      const { error } = await db.from('product_variants').update(payload).eq('id', variant.id);
      if (error) throw error;
      keep.add(variant.id);
      await ensureInventoryRow(db, product.id, variant.id);
    } else {
      const { data, error } = await db
        .from('product_variants')
        .insert(payload)
        .select('id')
        .single();
      if (error) {
        if (error.code === '23505') {
          throw new AppError('DUPLICATE_SKU', `The SKU "${variant.sku}" is already in use.`, 409, {
            field: 'variants'
          });
        }
        throw error;
      }
      keep.add(data.id);
      await ensureInventoryRow(db, product.id, data.id);
    }
  }

  for (const variant of existing) {
    if (!keep.has(variant.id) && variant.is_active) {
      const { error } = await db.from('product_variants').update({ is_active: false }).eq('id', variant.id);
      if (error) throw error;
    }
  }
}
