import { handler, ok, AppError, assertMethod, requireJson, readJson } from '../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../_lib/supabase.js';
import { cleanText, asInt } from '../_lib/validate.js';

export default handler(async (req, res) => {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'POST']);
  const db = serviceClient();

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const lowOnly = url.searchParams.get('low') === '1';
    const q = cleanText(url.searchParams.get('q'), { max: 60 }).toLowerCase();
    const page = Math.max(1, asInt(url.searchParams.get('page'), { min: 1, max: 10000, fallback: 1 }));
    const pageSize = Math.min(100, Math.max(1, asInt(url.searchParams.get('pageSize'), { min: 1, max: 100, fallback: 50 })));

    const { data, error } = await db
      .from('inventory')
      .select(
        `id, product_id, variant_id, stock_on_hand, stock_reserved, low_stock_threshold,
         supplier_stock, last_synced_at, updated_at,
         products ( id, name, sku, status ),
         product_variants ( id, name, sku, is_active )`
      )
      .order('updated_at', { ascending: false })
      .limit(2000);

    if (error) throw translateDbError(error);

    let items = (data ?? []).map((row) => ({
      ...row,
      available: Math.max(0, row.stock_on_hand - row.stock_reserved),
      product_name: row.products?.name ?? 'Unknown product',
      product_sku: row.products?.sku ?? '',
      variant_name: row.product_variants?.name ?? null,
      variant_sku: row.product_variants?.sku ?? null
    }));

    if (lowOnly) items = items.filter((row) => row.available <= row.low_stock_threshold);
    if (q) {
      items = items.filter(
        (row) =>
          row.product_name.toLowerCase().includes(q) ||
          row.product_sku.toLowerCase().includes(q) ||
          (row.variant_sku || '').toLowerCase().includes(q)
      );
    }

    const total = items.length;
    const from = (page - 1) * pageSize;
    return ok(res, { items: items.slice(from, from + pageSize), total, page, pageSize });
  }

  requireJson(req);
  const body = await readJson(req, { maxBytes: 16 * 1024 });
  const productId = cleanText(body.product_id, { max: 64 });
  const variantId = cleanText(body.variant_id, { max: 64 }) || null;
  const delta = asInt(body.delta, { min: -100000, max: 100000, fallback: null });

  if (!productId || delta === null || delta === 0) {
    throw new AppError('INVALID_STOCK_CHANGE', 'Enter a non-zero stock adjustment.', 400);
  }

  const { data, error } = await db.rpc('admin_adjust_stock', {
    p_product_id: productId,
    p_variant_id: variantId,
    p_delta: delta,
    p_note: cleanText(body.note, { max: 300 }) || null,
    p_actor: 'admin'
  });
  if (error) throw translateDbError(error);

  return ok(res, { inventory: data });
});
