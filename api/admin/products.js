import { handler, ok, AppError, assertMethod, requireJson, readJson } from '../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../_lib/supabase.js';
import { parsePagination, validateProductInput, slugify } from '../_lib/admin.js';
import { replaceImages, replaceCategories, syncVariants, loadAdminProduct } from '../_lib/product-admin.js';

function sanitiseSearch(value) {
  return String(value || '')
    .trim()
    .slice(0, 80)
    .replace(/[%,()]/g, ' ');
}

function primaryImage(images = []) {
  const sorted = [...images].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  return sorted[0]?.url ?? '/assets/products/placeholder.svg';
}

export default handler(async (req, res) => {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'POST']);
  const db = serviceClient();

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const { page, pageSize, from, to } = parsePagination(url, { defaultSize: 20, maxSize: 100 });
    const q = sanitiseSearch(url.searchParams.get('q'));
    const status = url.searchParams.get('status');
    const categoryId = url.searchParams.get('category');

    let ids = null;
    if (categoryId) {
      const { data: links, error } = await db
        .from('product_categories')
        .select('product_id')
        .eq('category_id', categoryId);
      if (error) throw error;
      ids = (links ?? []).map((row) => row.product_id);
      if (!ids.length) {
        return ok(res, { items: [], total: 0, page, pageSize });
      }
    }

    let query = db
      .from('products')
      .select(
        `id, sku, slug, name, status, price_minor, compare_at_price_minor, currency,
         availability, is_featured, is_best_seller, is_new_arrival, sales_count,
         published_at, updated_at,
         product_images ( url, is_primary, sort_order ),
         product_categories ( category_id, categories ( id, name, slug ) )`,
        { count: 'exact' }
      );

    if (status && ['draft', 'active', 'archived'].includes(status)) query = query.eq('status', status);
    if (ids) query = query.in('id', ids);
    if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,slug.ilike.%${q}%`);

    const { data, count, error } = await query
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (error) throw translateDbError(error);

    return ok(res, {
      items: (data ?? []).map((row) => ({
        ...row,
        primary_image: primaryImage(row.product_images),
        categories: (row.product_categories ?? []).map((link) => link.categories).filter(Boolean)
      })),
      total: count ?? 0,
      page,
      pageSize
    });
  }

  requireJson(req);
  const body = await readJson(req, { maxBytes: 256 * 1024 });
  const { product, images, categoryIds, variants } = validateProductInput(body);

  if (!product.name || !product.sku) {
    throw new AppError('INVALID_FIELD', 'A product needs a name and SKU.', 400);
  }
  if (product.compare_at_price_minor !== undefined && product.compare_at_price_minor !== null) {
    if (product.compare_at_price_minor < product.price_minor) {
      throw new AppError('INVALID_FIELD', 'Compare-at price cannot be lower than the price.', 400, {
        field: 'compare_at_price_minor'
      });
    }
  }

  const insert = {
    ...product,
    slug: product.slug || slugify(product.name),
    brand: product.brand || 'Hasswell London',
    status: product.status || 'draft',
    published_at: product.status === 'active' ? new Date().toISOString() : null
  };

  const { data: created, error } = await db.from('products').insert(insert).select('id').single();
  if (error) {
    if (error.code === '23505') {
      throw new AppError('DUPLICATE_PRODUCT', 'A product with that SKU or slug already exists.', 409);
    }
    throw translateDbError(error);
  }

  try {
    await replaceImages(db, created.id, images);
    await replaceCategories(db, created.id, categoryIds);
    const initial = {
      id: created.id,
      product_variants: []
    };
    await syncVariants(db, initial, variants);
  } catch (error) {
    // Best effort cleanup so a half-created product does not linger.
    await db.from('products').delete().eq('id', created.id);
    throw error;
  }

  const full = await loadAdminProduct(db, created.id);
  return ok(res, { product: full }, 201);
});
