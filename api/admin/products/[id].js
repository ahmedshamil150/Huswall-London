import { handler, ok, AppError, assertMethod, requireJson, readJson } from '../../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../../_lib/supabase.js';
import { validateProductInput } from '../../_lib/admin.js';
import {
  loadAdminProduct,
  replaceImages,
  replaceCategories,
  syncVariants
} from '../../_lib/product-admin.js';

export default handler(async (req, res) => {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'PATCH', 'DELETE']);

  const url = new URL(req.url, 'http://localhost');
  const id = url.pathname.split('/').filter(Boolean).pop();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError('INVALID_PRODUCT', 'Invalid product reference.', 400);
  }

  const db = serviceClient();
  const existing = await loadAdminProduct(db, id);

  if (req.method === 'GET') {
    return ok(res, { product: existing });
  }

  if (req.method === 'DELETE') {
    const { error } = await db
      .from('products')
      .update({ status: 'archived', archived_at: new Date().toISOString(), is_featured: false })
      .eq('id', id);
    if (error) throw translateDbError(error);
    return ok(res, { archived: true });
  }

  requireJson(req);
  const body = await readJson(req, { maxBytes: 256 * 1024 });
  const { product, images, categoryIds, variants } = validateProductInput(body, { partial: true });

  const effectivePrice = product.price_minor ?? existing.price_minor;
  const effectiveCompare =
    product.compare_at_price_minor !== undefined
      ? product.compare_at_price_minor
      : existing.compare_at_price_minor;
  if (effectiveCompare !== null && effectiveCompare < effectivePrice) {
    throw new AppError('INVALID_FIELD', 'Compare-at price cannot be lower than the price.', 400, {
      field: 'compare_at_price_minor'
    });
  }

  if (product.status === 'active' && !existing.published_at) {
    product.published_at = new Date().toISOString();
  }
  if (product.status === 'archived') product.archived_at = new Date().toISOString();

  if (Object.keys(product).length) {
    const { error } = await db.from('products').update(product).eq('id', id);
    if (error) {
      if (error.code === '23505') {
        throw new AppError('DUPLICATE_PRODUCT', 'A product with that SKU or slug already exists.', 409);
      }
      throw translateDbError(error);
    }
  }

  await replaceImages(db, id, images);
  await replaceCategories(db, id, categoryIds);
  await syncVariants(db, existing, variants);

  const full = await loadAdminProduct(db, id);
  return ok(res, { product: full });
});
