import { handler, ok, assertMethod } from '../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../_lib/supabase.js';
import { parsePagination } from '../_lib/admin.js';

export default handler(async (req, res) => {
  await requireAdmin(req);
  assertMethod(req, ['GET']);

  const url = new URL(req.url, 'http://localhost');
  const { page, pageSize, from, to } = parsePagination(url, { defaultSize: 50, maxSize: 200 });

  const { data, count, error } = await serviceClient()
    .from('newsletter_subscribers')
    .select('id, email, source, confirmed, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw translateDbError(error);
  return ok(res, { items: data ?? [], total: count ?? 0, page, pageSize });
});
