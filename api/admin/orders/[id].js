import { handler, ok, AppError, assertMethod, requireJson, readJson } from '../../_lib/http.js';
import { requireAdmin, serviceClient, translateDbError } from '../../_lib/supabase.js';
import { cleanText, cleanMultiline } from '../../_lib/validate.js';
import {
  getOrderById,
  getOrderItems,
  markOrderPaid,
  sendDispatchEmail,
  sendCancellationEmail,
  manualPaymentInstructions
} from '../../_lib/orders.js';
import { refreshSupplierOrderStatus } from '../../../integrations/suppliers/aw-dropship/sync-service.js';

const ALLOWED_STATUSES = [
  'paid',
  'awaiting_supplier',
  'submitted_to_supplier',
  'supplier_processing',
  'dispatched',
  'delivered'
];

function uidFromPath(url) {
  return url.pathname.split('/').filter(Boolean).pop();
}

export default handler(async (req, res) => {
  const { profile } = await requireAdmin(req);
  assertMethod(req, ['GET', 'PATCH', 'POST']);

  const url = new URL(req.url, 'http://localhost');
  const id = uidFromPath(url);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError('INVALID_ORDER', 'Invalid order reference.', 400);
  }

  const db = serviceClient();
  const actor = `admin:${profile.email}`;

  if (req.method === 'GET') {
    const order = await getOrderById(id);
    const [items, events, payments, supplierOrders] = await Promise.all([
      getOrderItems(id),
      db
        .from('order_events')
        .select('id, event_type, from_status, to_status, message, actor, metadata, created_at')
        .eq('order_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
      db
        .from('payment_transactions')
        .select('id, provider, provider_reference, amount_minor, currency, status, failure_reason, created_at')
        .eq('order_id', id)
        .order('created_at', { ascending: false }),
      db
        .from('supplier_orders')
        .select('id, supplier_id, external_reference, external_order_id, status, attempts, last_error, carrier, tracking_number, tracking_url, submitted_at, dispatched_at, last_synced_at, created_at')
        .eq('order_id', id)
        .order('created_at', { ascending: false })
    ]);

    return ok(res, {
      order,
      items,
      events: events.data ?? [],
      payments: payments.data ?? [],
      supplier_orders: supplierOrders.data ?? [],
      manual_payment_instructions: manualPaymentInstructions(order.order_number)
    });
  }

  requireJson(req);
  const body = await readJson(req, { maxBytes: 64 * 1024 });

  if (req.method === 'PATCH') {
    const adminNotes = cleanMultiline(body.admin_notes, { max: 4000 });
    const { error } = await db.from('orders').update({ admin_notes: adminNotes || null }).eq('id', id);
    if (error) throw translateDbError(error);
    const order = await getOrderById(id);
    return ok(res, { order });
  }

  const action = cleanText(body.action, { max: 40 });
  const order = await getOrderById(id);

  if (action === 'mark_paid') {
    if (order.payment_status === 'paid') return ok(res, { already_paid: true });

    const provider = order.payment_provider === 'stripe' ? 'stripe' : 'manual';
    const reference = cleanText(body.reference, { max: 160 });

    if (provider === 'stripe' && !reference) {
      throw new AppError(
        'REFERENCE_REQUIRED',
        'Check the Stripe dashboard first, then enter the payment reference.',
        400,
        { field: 'reference' }
      );
    }

    const result = await markOrderPaid({
      orderId: order.id,
      provider,
      reference: reference || `manual:${order.id}`,
      amountMinor: order.total_minor,
      currency: order.currency,
      raw: {
        verified_by: profile.email,
        method: 'admin_verification',
        note: cleanText(body.note, { max: 300 }),
        verified_at: new Date().toISOString()
      }
    });

    await db.from('order_events').insert({
      order_id: order.id,
      event_type: 'payment_verified_by_admin',
      message: `Payment verified by ${profile.email}.`,
      actor
    });

    return ok(res, { result, provider });
  }

  if (action === 'update_status') {
    const status = cleanText(body.status, { max: 40 });
    if (!ALLOWED_STATUSES.includes(status)) {
      throw new AppError('INVALID_STATUS', 'That status change is not allowed here.', 400, { field: 'status' });
    }
    if (status === 'dispatched') {
      throw new AppError(
        'USE_RECORD_SHIPMENT',
        'Record the carrier and tracking number to mark an order dispatched.',
        400,
        { field: 'status' }
      );
    }
    if (status === 'delivered' && !order.tracking_number) {
      throw new AppError(
        'TRACKING_REQUIRED',
        'Record dispatch and tracking before marking an order delivered.',
        409,
        { field: 'status' }
      );
    }
    const { data, error } = await db.rpc('admin_update_order_status', {
      p_order_id: order.id,
      p_status: status,
      p_note: cleanText(body.note, { max: 500 }) || null,
      p_actor: actor
    });
    if (error) throw translateDbError(error);

    if (status === 'dispatched') await sendDispatchEmail(order.id);
    return ok(res, { result: data });
  }

  if (action === 'cancel') {
    const reason = cleanText(body.reason, { max: 300 });
    if (reason.length < 3) {
      throw new AppError('REASON_REQUIRED', 'Enter a cancellation reason.', 400, { field: 'reason' });
    }
    const { data, error } = await db.rpc('cancel_order', {
      p_order_id: order.id,
      p_reason: reason,
      p_actor: actor
    });
    if (error) throw translateDbError(error);
    await sendCancellationEmail(order.id, reason);
    return ok(res, { result: data });
  }

  if (action === 'record_shipment') {
    const carrier = cleanText(body.carrier, { max: 80 });
    const trackingNumber = cleanText(body.tracking_number, { max: 120 });
    const trackingUrl = cleanText(body.tracking_url, { max: 500 });

    if (!carrier || !trackingNumber) {
      throw new AppError('TRACKING_REQUIRED', 'Enter the carrier and tracking number.', 400);
    }
    if (trackingUrl && !/^https?:\/\//i.test(trackingUrl)) {
      throw new AppError('INVALID_TRACKING_URL', 'Tracking URL must start with http:// or https://.', 400, {
        field: 'tracking_url'
      });
    }

    const { data, error } = await db.rpc('record_shipment', {
      p_order_id: order.id,
      p_carrier: carrier,
      p_tracking_number: trackingNumber,
      p_tracking_url: trackingUrl || null,
      p_actor: actor
    });
    if (error) throw translateDbError(error);
    await sendDispatchEmail(order.id);
    return ok(res, { result: data });
  }

  if (action === 'submit_supplier') {
    if (order.payment_status !== 'paid') {
      throw new AppError('PAYMENT_NOT_CONFIRMED', 'Only paid orders can be sent to the supplier.', 409);
    }
    if (order.status === 'cancelled' || order.status === 'failed') {
      throw new AppError('ORDER_NOT_SUBMITTABLE', 'This order can no longer be submitted.', 409);
    }

    let supplierQuery = db.from('supplier_accounts').select('*').eq('connector', 'aw-dropship');
    supplierQuery = body.supplier_id
      ? supplierQuery.eq('id', cleanText(body.supplier_id, { max: 64 }))
      : supplierQuery.eq('is_active', true);
    const { data: supplier, error: supplierError } = await supplierQuery.limit(1).maybeSingle();
    if (supplierError) throw supplierError;
    if (!supplier) {
      throw new AppError('SUPPLIER_NOT_CONFIGURED', 'No active AW Dropship account is configured.', 503);
    }

    const externalOrderId = cleanText(body.external_order_id, { max: 120 });
    const existing = await db
      .from('supplier_orders')
      .select('id, attempts')
      .eq('order_id', order.id)
      .maybeSingle();
    if (existing.error) throw existing.error;

    const payload = {
      order_id: order.id,
      supplier_id: supplier.id,
      external_reference: order.order_number,
      external_order_id: externalOrderId || null,
      status: 'submitted',
      attempts: Number(existing.data?.attempts ?? 0) + 1,
      last_error: null,
      submitted_at: new Date().toISOString(),
      raw_payload: {
        manual: true,
        submitted_by: profile.email,
        note: cleanText(body.note, { max: 300 })
      }
    };

    if (existing.data?.id) {
      const { error } = await db.from('supplier_orders').update(payload).eq('id', existing.data.id);
      if (error) throw error;
    } else {
      const { error } = await db.from('supplier_orders').insert({
        ...payload,
        idempotency_key: `order:${order.id}`
      });
      if (error) throw error;
    }

    const { error: statusError } = await db.rpc('admin_update_order_status', {
      p_order_id: order.id,
      p_status: 'submitted_to_supplier',
      p_note: 'Recorded as submitted to AW Dropship (manual submission).',
      p_actor: actor
    });
    if (statusError) throw translateDbError(statusError);

    return ok(res, {
      manual: true,
      note: 'Recorded as submitted manually. Automated AW submission is not enabled until the payload schema is verified.'
    });
  }

  if (action === 'sync_supplier') {
    let supplierOrderId = cleanText(body.supplier_order_id, { max: 64 });
    if (!supplierOrderId) {
      const { data: record } = await db
        .from('supplier_orders')
        .select('id')
        .eq('order_id', order.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      supplierOrderId = record?.id ?? null;
    }
    if (!supplierOrderId) {
      throw new AppError('SUPPLIER_ORDER_NOT_FOUND', 'No supplier record exists for this order.', 404);
    }
    const result = await refreshSupplierOrderStatus(supplierOrderId);
    return ok(res, { result });
  }

  if (action === 'add_note') {
    const note = cleanMultiline(body.note, { max: 2000 });
    if (!note) throw new AppError('NOTE_REQUIRED', 'Enter a note.', 400);
    const { error } = await db.from('order_events').insert({
      order_id: order.id,
      event_type: 'admin_note',
      message: note,
      actor
    });
    if (error) throw error;
    return ok(res, { added: true });
  }

  throw new AppError('INVALID_ACTION', 'That order action is not supported.', 400);
});
