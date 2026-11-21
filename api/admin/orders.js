import { handler, ok, assertMethod, AppError } from '../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../_lib/supabase.js';
import { parsePagination } from '../_lib/admin.js';

const ORDER_STATUSES = new Set([
  'pending_payment',
  'paid',
  'awaiting_supplier',
  'submitted_to_supplier',
  'supplier_processing',
  'dispatched',
  'delivered',
  'cancelled',
  'failed'
]);

const PAYMENT_STATUSES = new Set([
  'pending',
  'authorised',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
  'cancelled'
]);

function filterValue(params, key, allowed) {
  const raw = params.get(key);
  if (raw === null || raw === '') return null;
  const value = String(raw).trim();
  if (!allowed.has(value)) {
    throw new AppError('INVALID_FILTER', `Unknown ${key.replace('_', ' ')} filter.`, 400, { field: key });
  }
  return value;
}

function sanitiseSearch(value) {
  return String(value || '')
    .trim()
    .slice(0, 80)
    .replace(/[%,()]/g, ' ');
}

export default handler(async (req, res) => {
  await requireAdmin(req);
  assertMethod(req, ['GET']);

  const url = new URL(req.url, 'http://localhost');
  const { page, pageSize, from, to } = parsePagination(url, { defaultSize: 25, maxSize: 100 });
  const q = sanitiseSearch(url.searchParams.get('q'));
  const status = filterValue(url.searchParams, 'status', ORDER_STATUSES);
  const paymentStatus = filterValue(url.searchParams, 'payment_status', PAYMENT_STATUSES);

  let query = serviceClient()
    .from('orders')
    .select(
      `id, order_number, email, shipping_name, total_minor, currency, status,
       payment_status, fulfilment_status, payment_provider, carrier, tracking_number,
       placed_at, paid_at, dispatched_at`,
      { count: 'exact' }
    );

  if (status) query = query.eq('status', status);
  if (paymentStatus) query = query.eq('payment_status', paymentStatus);
  if (q) query = query.or(`order_number.ilike.%${q}%,email.ilike.%${q}%,shipping_name.ilike.%${q}%`);

  const { data, count, error } = await query.order('placed_at', { ascending: false }).range(from, to);
  if (error) throw translateDbError(error);

  return ok(res, { items: data ?? [], total: count ?? 0, page, pageSize });
});
