import { handler, ok, assertMethod } from '../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../_lib/supabase.js';

export default handler(async (req, res) => {
  assertMethod(req, ['GET']);
  const { profile } = await requireAdmin(req);

  const { data, error } = await serviceClient().rpc('admin_dashboard_stats');
  if (error) throw translateDbError(error);

  return ok(res, {
    admin: { email: profile.email, name: profile.full_name || profile.email },
    stats: data ?? {}
  });
});
