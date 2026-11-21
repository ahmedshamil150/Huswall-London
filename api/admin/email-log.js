import { handler, ok, assertMethod } from '../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../_lib/supabase.js';

export default handler(async (req, res) => {
  await requireAdmin(req);
  assertMethod(req, ['GET']);

  const { data, error } = await serviceClient()
    .from('email_log')
    .select('id, order_id, to_email, template, subject, status, provider, error, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw translateDbError(error);
  return ok(res, { items: data ?? [] });
});
