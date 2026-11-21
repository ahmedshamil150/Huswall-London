import { handler, ok, AppError, assertMethod, requireJson, readJson } from '../../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../../_lib/supabase.js';
import { cleanText, asInt, asBoolean } from '../../_lib/validate.js';
import { cleanSlug } from '../../_lib/admin.js';

export default handler(async (req, res) => {
  await requireAdmin(req);
  assertMethod(req, ['PATCH', 'DELETE']);

  const url = new URL(req.url, 'http://localhost');
  const id = url.pathname.split('/').filter(Boolean).pop();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError('INVALID_CATEGORY', 'Invalid category reference.', 400);
  }

  const db = serviceClient();

  if (req.method === 'DELETE') {
    const { error } = await db.from('categories').update({ is_active: false }).eq('id', id);
    if (error) throw translateDbError(error);
    return ok(res, { archived: true });
  }

  requireJson(req);
  const body = await readJson(req, { maxBytes: 32 * 1024 });
  const update = {};

  if (body.name !== undefined) {
    update.name = cleanText(body.name, { max: 120 });
    if (!update.name) throw new AppError('INVALID_CATEGORY', 'Enter a category name.', 400);
  }
  if (body.slug !== undefined) update.slug = cleanSlug(body.slug, update.name || body.slug);
  if (body.description !== undefined) update.description = cleanText(body.description, { max: 500 }) || null;
  if (body.image_url !== undefined) update.image_url = cleanText(body.image_url, { max: 800 }) || null;
  if (body.sort_order !== undefined) {
    update.sort_order = asInt(body.sort_order, { min: 0, max: 9999, fallback: 0 });
  }
  if (body.is_active !== undefined) update.is_active = asBoolean(body.is_active);

  if (!Object.keys(update).length) {
    throw new AppError('INVALID_CATEGORY', 'No changes were provided.', 400);
  }

  const { data, error } = await db.from('categories').update(update).eq('id', id).select('*').single();
  if (error) {
    if (error.code === '23505') {
      throw new AppError('DUPLICATE_CATEGORY', 'A category with that slug already exists.', 409);
    }
    throw translateDbError(error);
  }
  return ok(res, { category: data });
});
