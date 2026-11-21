import { handler, ok, AppError, assertMethod, requireJson, readJson } from '../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../_lib/supabase.js';
import { parsePagination } from '../_lib/admin.js';
import { cleanText } from '../_lib/validate.js';

const STATUSES = ['new', 'read', 'replied', 'archived'];

export default handler(async (req, res) => {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'PATCH']);
  const db = serviceClient();

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const { page, pageSize, from, to } = parsePagination(url, { defaultSize: 25, maxSize: 100 });
    const status = url.searchParams.get('status');
    let query = db
      .from('contact_messages')
      .select('id, name, email, subject, message, status, created_at', { count: 'exact' });
    if (status && STATUSES.includes(status)) query = query.eq('status', status);
    const { data, count, error } = await query.order('created_at', { ascending: false }).range(from, to);
    if (error) throw translateDbError(error);
    return ok(res, { items: data ?? [], total: count ?? 0, page, pageSize });
  }

  requireJson(req);
  const body = await readJson(req, { maxBytes: 16 * 1024 });
  const id = cleanText(body.id, { max: 64 });
  const status = cleanText(body.status, { max: 20 });
  if (!id || !STATUSES.includes(status)) {
    throw new AppError('INVALID_MESSAGE', 'Choose a valid message status.', 400);
  }
  const { error } = await db.from('contact_messages').update({ status }).eq('id', id);
  if (error) throw translateDbError(error);
  return ok(res, { updated: true });
});
