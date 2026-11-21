import { serviceClient } from '../../../api/_lib/supabase.js';
import { createHash } from 'node:crypto';
import { createSupplierConnector } from '../registry.js';
import { SupplierError } from '../connector.js';

/**
 * Supplier catalogue and stock synchronisation.
 *
 * Flow:
 *  1. Resolve an active supplier account.
 *  2. Fetch the documented AW product feed (paginated fallback).
 *  3. Upsert supplier_products, auto-linking by exact SKU where possible.
 *  4. Apply stock through apply_supplier_stock_batch(), which is transactional
 *     and writes inventory_movements for every change.
 *  5. Record a supplier_sync_logs row with counts and a redacted error.
 *
 * Webhooks are not offered by AW, so this is designed to run from Vercel Cron.
 */

const PAGE_SIZE = 1000;
const UPSERT_CHUNK = 100;
const STOCK_CHUNK = 200;

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function shortHash(value) {
  return createHash('sha1').update(String(value)).digest('hex').slice(0, 8);
}

async function fetchAllRows(db, table, columns) {
  const rows = [];
  for (let from = 0; from < 50000; from += PAGE_SIZE) {
    const { data, error } = await db.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function resolveSupplier(supplierId) {
  const db = serviceClient();
  let query = db.from('supplier_accounts').select('*');
  query = supplierId ? query.eq('id', supplierId) : query.eq('is_active', true).eq('connector', 'aw-dropship');
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function openLog(supplierId, jobType, metadata) {
  const db = serviceClient();
  const { data, error } = await db
    .from('supplier_sync_logs')
    .insert({ supplier_id: supplierId, job_type: jobType, status: 'running', metadata })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function closeLog(id, { status, processed = 0, failed = 0, errorMessage = null, metadata = {} }) {
  const db = serviceClient();
  await db
    .from('supplier_sync_logs')
    .update({
      status,
      records_processed: processed,
      records_failed: failed,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
      metadata,
      finished_at: new Date().toISOString()
    })
    .eq('id', id);
}

/**
 * Creates draft products for supplier SKUs that are not linked yet. Drafts are
 * deliberately not published: retail copy, pricing and imagery need a human.
 */
async function createDraftProducts(rows, productBySku) {
  const db = serviceClient();
  let created = 0;
  const errors = [];

  for (const row of rows) {
    if (productBySku.has(row.supplierSku.toLowerCase())) continue;
    const base = slugify(row.name) || 'supplier-product';
    const slug = `${base}-${shortHash(row.supplierSku)}`;

    const { data, error } = await db
      .from('products')
      .insert({
        sku: row.supplierSku,
        slug,
        name: row.name || row.supplierSku,
        brand: 'Hasswell London',
        short_description: null,
        description: null,
        price_minor: row.rrpMinor ?? row.priceMinor ?? 0,
        status: 'draft',
        availability: 'out_of_stock',
        meta_title: `${row.name || row.supplierSku} | Hasswell London`,
        meta_description: null
      })
      .select('id, sku')
      .single();

    if (error) {
      errors.push(`${row.supplierSku}: ${error.message}`);
      continue;
    }
    productBySku.set(data.sku.toLowerCase(), { id: data.id, sku: data.sku });
    created += 1;
  }

  return { created, errors };
}

export async function syncSupplier({ supplierId = null, createMissingProducts = false } = {}) {
  const account = await resolveSupplier(supplierId);
  if (!account) {
    return {
      skipped: true,
      reason: 'No active supplier account is configured. Set supplier_accounts.is_active = true after adding credentials.'
    };
  }

  const logId = await openLog(account.id, 'catalogue_sync', {
    connector: account.connector,
    createMissingProducts
  });

  let processed = 0;
  let failed = 0;

  try {
    const connector = createSupplierConnector(account);
    const products = await connector.fetchCatalogue();

    if (!products.length) {
      await closeLog(logId, {
        status: 'success',
        metadata: { note: 'The supplier returned no products.', received: 0 }
      });
      return { skipped: false, received: 0, processed: 0, failed: 0, created: 0, linked: 0, changed: 0 };
    }

    const db = serviceClient();
    const productRows = await fetchAllRows(db, 'products', 'id, sku');
    const variantRows = await fetchAllRows(db, 'product_variants', 'id, product_id, sku');

    const productBySku = new Map(productRows.map((row) => [String(row.sku).toLowerCase(), row]));
    const variantBySku = new Map(variantRows.map((row) => [String(row.sku).toLowerCase(), row]));

    let created = 0;
    const createErrors = [];
    if (createMissingProducts) {
      const result = await createDraftProducts(products, productBySku);
      created = result.created;
      createErrors.push(...result.errors);
    }

    // Upsert the supplier catalogue mapping first so apply_supplier_stock_batch
    // can resolve every SKU.
    const now = new Date().toISOString();
    const supplierRows = products.map((row) => {
      const key = row.supplierSku.toLowerCase();
      const variant = variantBySku.get(key) ?? null;
      const product = variant ? { id: variant.product_id } : productBySku.get(key) ?? null;
      return {
        supplier_id: account.id,
        supplier_sku: row.supplierSku,
        supplier_product_id: row.supplierProductId,
        product_id: product?.id ?? null,
        variant_id: variant?.id ?? null,
        supplier_price_minor: row.priceMinor,
        supplier_rrp_minor: row.rrpMinor,
        supplier_stock: row.stock,
        supplier_availability: row.availability,
        is_active: true,
        raw_payload: row.raw ?? {},
        last_synced_at: now
      };
    });

    for (const batch of chunk(supplierRows, UPSERT_CHUNK)) {
      const { error } = await db
        .from('supplier_products')
        .upsert(batch, { onConflict: 'supplier_id,supplier_sku' });
      if (error) throw error;
    }

    const linked = supplierRows.filter((row) => row.product_id).length;

    // Only rows with an explicit stock value are applied; a missing stock field
    // must never be interpreted as zero.
    const stockRows = products
      .filter((row) => row.stock !== null)
      .map((row) => ({
        supplier_sku: row.supplierSku,
        stock: row.stock,
        price_minor: row.priceMinor,
        availability: row.availability
      }));

    let stockResult = { processed: 0, failed: 0, changed: 0 };
    if (stockRows.length) {
      const aggregate = { processed: 0, failed: 0, changed: 0 };
      for (const batch of chunk(stockRows, STOCK_CHUNK)) {
        const { data, error } = await db.rpc('apply_supplier_stock_batch', {
          p_supplier_id: account.id,
          p_rows: batch
        });
        if (error) throw error;
        aggregate.processed += Number(data?.processed ?? 0);
        aggregate.failed += Number(data?.failed ?? 0);
        aggregate.changed += Number(data?.changed ?? 0);
      }
      stockResult = aggregate;
    }

    processed = stockResult.processed;
    failed = stockResult.failed + createErrors.length;

    await db
      .from('supplier_accounts')
      .update({ last_sync_at: new Date().toISOString(), capabilities: {
        ...(account.capabilities ?? {}),
        ...connector.capabilities()
      } })
      .eq('id', account.id);

    await closeLog(logId, {
      status: failed > 0 ? 'partial' : 'success',
      processed,
      failed,
      errorMessage: createErrors.length ? createErrors.slice(0, 5).join('; ') : null,
      metadata: {
        received: products.length,
        linked,
        created,
        changed: stockResult.changed,
        connector: account.connector
      }
    });

    return {
      skipped: false,
      supplier: account.slug,
      received: products.length,
      processed,
      failed,
      linked,
      created,
      changed: stockResult.changed
    };
  } catch (error) {
    await closeLog(logId, {
      status: 'failed',
      processed,
      failed: failed || 1,
      errorMessage: error?.message || String(error),
      metadata: { connector: account.connector }
    });
    if (error instanceof SupplierError) throw error;
    throw new SupplierError('SUPPLIER_SYNC_FAILED', 'Supplier synchronisation failed.', {
      status: 502,
      details: { message: String(error?.message || error).slice(0, 300) }
    });
  }
}

/**
 * Polls one supplier order and applies confirmed status/tracking.
 *
 * Dispatch only happens when the supplier returns a tracking number and the
 * order is already paid. Record_shipment() enforces that rule again in SQL.
 */
export async function refreshSupplierOrderStatus(supplierOrderId) {
  const db = serviceClient();
  const { data: supplierOrder, error } = await db
    .from('supplier_orders')
    .select('*, supplier_accounts (*)')
    .eq('id', supplierOrderId)
    .maybeSingle();

  if (error) throw error;
  if (!supplierOrder) {
    throw new SupplierError('SUPPLIER_ORDER_NOT_FOUND', 'That supplier order could not be found.', { status: 404 });
  }

  const account = supplierOrder.supplier_accounts;
  const connector = createSupplierConnector(account);
  if (!connector.capabilities().orderStatusPolling) {
    throw new SupplierError('SUPPLIER_STATUS_UNAVAILABLE', 'This supplier does not support status polling.', {
      status: 409
    });
  }

  const reference = supplierOrder.external_order_id || supplierOrder.external_reference;
  const result = await connector.getOrderStatus(reference);

  await db
    .from('supplier_orders')
    .update({
      status: result.status,
      attempts: Number(supplierOrder.attempts || 0) + 1,
      last_error: null,
      last_synced_at: new Date().toISOString(),
      raw_payload: result.raw ?? {},
      ...(result.tracking.carrier ? { carrier: result.tracking.carrier } : {}),
      ...(result.tracking.number ? { tracking_number: result.tracking.number } : {}),
      ...(result.tracking.url ? { tracking_url: result.tracking.url } : {})
    })
    .eq('id', supplierOrderId);

  let orderStatus = null;

  if (result.status === 'dispatched' && result.tracking.number) {
    const { error: shipmentError } = await db.rpc('record_shipment', {
      p_order_id: supplierOrder.order_id,
      p_carrier: result.tracking.carrier,
      p_tracking_number: result.tracking.number,
      p_tracking_url: result.tracking.url,
      p_actor: 'supplier_sync'
    });
    if (shipmentError) throw shipmentError;
    orderStatus = 'dispatched';
  } else if (result.status === 'processing') {
    const { error: statusError } = await db.rpc('admin_update_order_status', {
      p_order_id: supplierOrder.order_id,
      p_status: 'supplier_processing',
      p_note: 'Supplier status updated by polling.',
      p_actor: 'supplier_sync'
    });
    // Invalid transitions (e.g. already dispatched) are not fatal for polling.
    if (!statusError) orderStatus = 'supplier_processing';
  }

  return {
    supplier_order_id: supplierOrderId,
    status: result.status,
    raw_status: result.rawStatus,
    tracking: result.tracking,
    order_status: orderStatus
  };
}
