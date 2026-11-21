import { handler, ok, AppError, assertMethod, requireJson, readJson } from '../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../_lib/supabase.js';
import { cleanText, asInt, asBoolean } from '../_lib/validate.js';
import { cleanSlug } from '../_lib/admin.js';

export default handler(async (req, res) => {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'POST']);
  const db = serviceClient();

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('categories')
      .select('id, parent_id, name, slug, description, image_url, sort_order, is_active, created_at, updated_at, product_categories ( product_id )')
      .order('sort_order', { ascending: true });
    if (error) throw translateDbError(error);
    return ok(res, {
      items: (data ?? []).map((row) => ({ ...row, product_count: row.product_categories?.length ?? 0 }))
    });
  }

  requireJson(req);
  const body = await readJson(req, { maxBytes: 32 * 1024 });
  const name = cleanText(body.name, { max: 120 });
  if (!name) throw new AppError('INVALID_CATEGORY', 'Enter a category name.', 400, { field: 'name' });

  const { data, error } = await db
    .from('categories')
    .insert({
      name,
      slug: cleanSlug(body.slug, name),
      description: cleanText(body.description, { max: 500 }) || null,
      image_url: cleanText(body.image_url, { max: 800 }) || null,
      sort_order: asInt(body.sort_order, { min: 0, max: 9999, fallback: 0 }),
      is_active: body.is_active === undefined ? true : asBoolean(body.is_active)
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new AppError('DUPLICATE_CATEGORY', 'A category with that slug already exists.', 409);
    }
    throw translateDbError(error);
  }
  return ok(res, { category: data }, 201);
});
