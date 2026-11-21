import { handler, ok, assertMethod, requireJson, readJson } from '../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../_lib/supabase.js';
import { SETTINGS_SPEC, validateSettingsInput } from '../_lib/admin.js';

export default handler(async (req, res) => {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'PATCH']);
  const db = serviceClient();

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('store_settings')
      .select('key, value, is_public, updated_at')
      .order('key', { ascending: true });
    if (error) throw translateDbError(error);
    return ok(res, { items: data ?? [], spec: SETTINGS_SPEC });
  }

  requireJson(req);
  const body = await readJson(req, { maxBytes: 64 * 1024 });
  const settings = validateSettingsInput(body);

  const rows = Object.entries(settings).map(([key, value]) => ({
    key,
    value,
    is_public: SETTINGS_SPEC[key]?.public ?? false,
    updated_at: new Date().toISOString()
  }));

  const { error } = await db.from('store_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw translateDbError(error);

  const { data } = await db.from('store_settings').select('key, value, is_public, updated_at').order('key');
  return ok(res, { items: data ?? [] });
});
