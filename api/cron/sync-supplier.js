import { timingSafeEqual } from 'node:crypto';
import { handler, ok, AppError, assertMethod } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import { serviceClient } from '../_lib/supabase.js';
import { syncSupplier } from '../../integrations/suppliers/aw-dropship/sync-service.js';

function authorised(req, secret) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7).trim());
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/**
 * Vercel Cron entry point.
 *
 * Runs supplier catalogue/stock sync, releases expired unpaid reservations and
 * prunes operational tables. Supplier failures are reported in the response but
 * do not prevent stock release or housekeeping.
 */
export default handler(async (req, res) => {
  assertMethod(req, ['GET', 'POST']);

  const secret = env('CRON_SECRET');
  if (!secret) {
    throw new AppError('CRON_NOT_CONFIGURED', 'CRON_SECRET is not configured.', 503);
  }
  if (!authorised(req, secret)) {
    throw new AppError('UNAUTHORISED', 'Cron authorisation failed.', 401);
  }

  const url = new URL(req.url, 'http://localhost');
  const createMissing = url.searchParams.get('create_missing_products') === '1';

  let supplier = null;
  let supplierError = null;

  try {
    supplier = await syncSupplier({ createMissingProducts: createMissing });
  } catch (error) {
    supplierError = { code: error?.code || 'SUPPLIER_SYNC_FAILED', message: error?.message || 'Sync failed.' };
    console.error('[cron] supplier sync failed:', error?.message || error);
  }

  const db = serviceClient();
  let released = 0;
  try {
    const { data, error } = await db.rpc('release_expired_orders', { p_hours: 24 });
    if (error) throw error;
    released = Number(data ?? 0);
  } catch (error) {
    console.error('[cron] release expired orders failed:', error?.message || error);
  }

  let pruned = false;
  try {
    const { error } = await db.rpc('prune_operational_tables');
    pruned = !error;
  } catch (error) {
    console.error('[cron] prune failed:', error?.message || error);
  }

  return ok(res, {
    supplier,
    supplier_error: supplierError,
    released_orders: released,
    pruned
  });
});
