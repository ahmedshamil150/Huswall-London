import { handler, ok, AppError, assertMethod, requireJson, readJson } from '../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../_lib/supabase.js';
import { env } from '../_lib/env.js';
import { cleanText, asBoolean } from '../_lib/validate.js';
import { createSupplierConnector } from '../../integrations/suppliers/registry.js';
import { syncSupplier } from '../../integrations/suppliers/aw-dropship/sync-service.js';

export default handler(async (req, res) => {
  await requireAdmin(req);
  assertMethod(req, ['GET', 'POST']);
  const db = serviceClient();

  if (req.method === 'GET') {
    const [accounts, logs, products] = await Promise.all([
      db.from('supplier_accounts').select('*').order('created_at'),
      db.from('supplier_sync_logs').select('*').order('started_at', { ascending: false }).limit(20),
      db.from('supplier_products').select('supplier_id, product_id')
    ]);

    if (accounts.error) throw translateDbError(accounts.error);

    const counts = (products.data ?? []).reduce((acc, row) => {
      acc[row.supplier_id] = acc[row.supplier_id] ?? { products: 0, linked: 0 };
      acc[row.supplier_id].products += 1;
      if (row.product_id) acc[row.supplier_id].linked += 1;
      return acc;
    }, {});

    return ok(res, {
      items: (accounts.data ?? []).map((account) => ({
        ...account,
        counts: counts[account.id] ?? { products: 0, linked: 0 },
        runtime: {
          token_configured: Boolean(env('AW_DROPSHIP_API_TOKEN')),
          base_url: env('AW_DROPSHIP_BASE_URL') || account.api_base_url,
          order_submission_enabled: env('AW_DROPSHIP_ORDER_SUBMISSION_ENABLED', 'false') === 'true',
          order_submission_verified: false,
          manual_submission_required: true
        }
      })),
      logs: logs.data ?? []
    });
  }

  requireJson(req);
  const body = await readJson(req, { maxBytes: 32 * 1024 });
  const action = cleanText(body.action, { max: 40 });

  const { data: account, error } = await db
    .from('supplier_accounts')
    .select('*')
    .eq('id', cleanText(body.supplier_id, { max: 64 }))
    .maybeSingle();
  if (error) throw translateDbError(error);
  if (!account) throw new AppError('SUPPLIER_NOT_FOUND', 'That supplier account could not be found.', 404);

  if (action === 'test') {
    const connector = createSupplierConnector(account);
    const products = await connector.fetchCatalogue();
    return ok(res, {
      connected: true,
      products_found: products.length,
      sample: products.slice(0, 5).map((row) => ({ sku: row.supplierSku, name: row.name, stock: row.stock })),
      wrote_data: false,
      note: 'Read-only connection test. No catalogue or stock data was written.'
    });
  }

  if (action === 'sync') {
    const result = await syncSupplier({
      supplierId: account.id,
      createMissingProducts: asBoolean(body.create_missing_products)
    });
    return ok(res, { result });
  }

  if (action === 'toggle') {
    const isActive = asBoolean(body.is_active);
    const { error: updateError } = await db
      .from('supplier_accounts')
      .update({ is_active: isActive })
      .eq('id', account.id);
    if (updateError) throw updateError;
    return ok(res, { is_active: isActive });
  }

  if (action === 'update') {
    const update = {};
    if (body.name !== undefined) {
      update.name = cleanText(body.name, { max: 120 });
      if (!update.name) throw new AppError('INVALID_SUPPLIER', 'Enter a supplier name.', 400);
    }
    if (body.api_base_url !== undefined) {
      const baseUrl = cleanText(body.api_base_url, { max: 300 });
      if (baseUrl && !/^https:\/\//i.test(baseUrl)) {
        throw new AppError('INVALID_SUPPLIER', 'Supplier base URL must use https.', 400);
      }
      update.api_base_url = baseUrl || null;
    }
    if (body.notes !== undefined) update.notes = cleanText(body.notes, { max: 1000 }) || null;
    if (body.credentials_ref !== undefined) {
      const ref = cleanText(body.credentials_ref, { max: 80 });
      if (ref && !/^[A-Z0-9_]+$/.test(ref)) {
        throw new AppError('INVALID_SUPPLIER', 'Credentials reference must be an environment variable name.', 400);
      }
      update.credentials_ref = ref || null;
    }
    if (!Object.keys(update).length) {
      throw new AppError('INVALID_SUPPLIER', 'No changes were provided.', 400);
    }
    const { error: updateError } = await db.from('supplier_accounts').update(update).eq('id', account.id);
    if (updateError) throw updateError;
    return ok(res, { updated: true });
  }

  throw new AppError('INVALID_ACTION', 'That supplier action is not supported.', 400);
});
