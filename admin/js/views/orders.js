import { adminApi } from '../api.js';
import {
  escapeHtml,
  formatMoney,
  formatDateTime,
  orderBadge,
  paymentBadge,
  pageHead,
  notice,
  selectOptions,
  statusLabel,
  toast,
  setBusy
} from '../ui.js';

const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'awaiting_supplier',
  'submitted_to_supplier',
  'supplier_processing',
  'dispatched',
  'delivered',
  'cancelled',
  'failed'
];

const PAYMENT_STATUSES = [
  'pending',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
  'cancelled'
];

export async function renderOrders(view) {
  const state = { q: '', status: '', payment_status: '', page: 1 };

  view.innerHTML = `
    ${pageHead({ title: 'Orders', subtitle: 'Payment and fulfilment are tracked independently.' })}
    <section class="card">
      <form class="toolbar" id="order-filters">
        <div class="field">
          <label for="order-search">Search</label>
          <input id="order-search" name="q" type="search" placeholder="Order number, email or name">
        </div>
        <div class="field">
          <label for="order-status">Order status</label>
          <select id="order-status" name="status"><option value="">All</option>${selectOptions(ORDER_STATUSES)}</select>
        </div>
        <div class="field">
          <label for="payment-status">Payment</label>
          <select id="payment-status" name="payment_status"><option value="">All</option>${selectOptions(
            PAYMENT_STATUSES
          )}</select>
        </div>
        <button class="btn btn--ghost" type="submit">Filter</button>
      </form>
      <div id="order-results"></div>
    </section>`;

  const results = view.querySelector('#order-results');

  async function load() {
    results.innerHTML = '<div class="empty">Loading orders…</div>';
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.status) params.set('status', state.status);
    if (state.payment_status) params.set('payment_status', state.payment_status);
    params.set('page', String(state.page));

    try {
      const data = await adminApi(`/orders?${params.toString()}`);
      results.innerHTML = `${
        data.items?.length
          ? `<div class="table-wrap">
               <table class="data-table">
                 <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Fulfilment</th><th>Placed</th><th></th></tr></thead>
                 <tbody>
                   ${data.items
                     .map(
                       (order) => `<tr>
                         <td><a class="link mono" href="#/orders/${escapeHtml(order.id)}">${escapeHtml(
                           order.order_number
                         )}</a></td>
                         <td>${escapeHtml(order.shipping_name)}<span class="cell-sub">${escapeHtml(order.email)}</span></td>
                         <td class="nowrap">${formatMoney(order.total_minor, order.currency)}</td>
                         <td>${paymentBadge(order.payment_status)}</td>
                         <td>${orderBadge(order.status)}</td>
                         <td class="nowrap small muted">${formatDateTime(order.placed_at)}</td>
                         <td class="right"><a class="btn btn--ghost btn--sm" href="#/orders/${escapeHtml(
                           order.id
                         )}">Open</a></td>
                       </tr>`
                     )
                     .join('')}
                 </tbody>
               </table>
             </div>
             <div class="pagination">
               <span>Page ${data.page} · ${data.total} order${data.total === 1 ? '' : 's'}</span>
               <span class="cluster">
                 <button class="btn btn--ghost btn--sm" type="button" data-page="${data.page - 1}" ${
                   data.page <= 1 ? 'disabled' : ''
                 }>Previous</button>
                 <button class="btn btn--ghost btn--sm" type="button" data-page="${data.page + 1}" ${
                   data.page * data.pageSize >= data.total ? 'disabled' : ''
                 }>Next</button>
               </span>
             </div>`
          : `<div class="empty">No orders match those filters.</div>`
      }`;
      results.querySelectorAll('[data-page]').forEach((button) => {
        button.addEventListener('click', () => {
          state.page = Number(button.dataset.page);
          load();
        });
      });
    } catch (error) {
      results.innerHTML = notice(escapeHtml(error.message), 'error');
    }
  }

  view.querySelector('#order-filters').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.q = String(data.get('q') || '').trim();
    state.status = String(data.get('status') || '');
    state.payment_status = String(data.get('payment_status') || '');
    state.page = 1;
    load();
  });

  await load();
}

export async function renderOrderDetail(view, context, id) {
  view.innerHTML = '<div class="empty">Loading order…</div>';

  let data;
  try {
    data = await adminApi(`/orders/${id}`);
  } catch (error) {
    view.innerHTML = notice(escapeHtml(error.message), 'error');
    return;
  }

  const { order, items, events, payments, supplier_orders: supplierOrders } = data;
  const address = [
    order.shipping_name,
    order.shipping_line1,
    order.shipping_line2,
    order.shipping_city,
    order.shipping_region,
    order.shipping_postcode,
    order.shipping_country
  ].filter(Boolean);

  const pending = order.payment_status === 'pending';
  const paid = order.payment_status === 'paid';

  view.innerHTML = `
    ${pageHead({
      title: order.order_number,
      subtitle: `${formatDateTime(order.placed_at)} · ${order.email}`,
      actions: `<a class="btn btn--ghost" href="#/orders">Back to orders</a>`
    })}

    <div class="badge-row" style="margin-bottom:1.2rem">
      ${orderBadge(order.status)}
      ${paymentBadge(order.payment_status)}
      <span class="badge badge--grey">${escapeHtml(statusLabel(order.fulfilment_status))}</span>
      ${order.payment_provider ? `<span class="badge badge--blue">${escapeHtml(order.payment_provider)}</span>` : ''}
    </div>

    <div class="order-grid">
      <div class="stack">
        <section class="card">
          <div class="card__head"><h3>Items</h3><span class="small muted">${items.length} line${items.length === 1 ? '' : 's'}</span></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th>Unit</th><th class="right">Total</th></tr></thead>
              <tbody>
                ${items
                  .map(
                    (item) => `<tr>
                      <td>${escapeHtml(item.name)}${
                        item.variant_name ? `<span class="cell-sub">${escapeHtml(item.variant_name)}</span>` : ''
                      }</td>
                      <td class="mono small">${escapeHtml(item.sku)}</td>
                      <td>${item.quantity}</td>
                      <td class="nowrap">${formatMoney(item.unit_price_minor, order.currency)}</td>
                      <td class="right nowrap">${formatMoney(item.line_total_minor, order.currency)}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
          <div class="card__body">
            <div class="detail-list">
              <div class="row"><span>Subtotal</span><span>${formatMoney(order.subtotal_minor, order.currency)}</span></div>
              <div class="row"><span>Delivery</span><span>${
                order.shipping_minor === 0 ? 'Included' : formatMoney(order.shipping_minor, order.currency)
              }</span></div>
              <div class="row"><span>Discount</span><span>${formatMoney(
                order.discount_minor,
                order.currency
              )}</span></div>
              <div class="row"><span><strong>Total</strong></span><span><strong>${formatMoney(
                order.total_minor,
                order.currency
              )}</strong></span></div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card__head"><h3>Payment</h3>${paymentBadge(order.payment_status)}</div>
          <div class="card__body stack">
            ${
              pending && order.payment_provider === 'manual' && data.manual_payment_instructions
                ? `<div class="code-block">${escapeHtml(data.manual_payment_instructions)}</div>
                   <p class="small muted">Verify the transfer in the bank account before marking paid. This changes stock and starts fulfilment.</p>
                   <form id="mark-paid-form" class="form-grid">
                     <div class="field">
                       <label for="payment-reference">Bank reference (optional)</label>
                       <input id="payment-reference" name="reference" type="text" placeholder="e.g. Faster Payment reference">
                     </div>
                     <div class="field">
                       <label for="payment-note">Internal note</label>
                       <input id="payment-note" name="note" type="text" placeholder="Checked against statement">
                     </div>
                     <div class="field field--full">
                       <button class="btn" type="submit" id="mark-paid-button">Mark payment received</button>
                     </div>
                   </form>`
                : ''
            }
            ${
              pending && order.payment_provider === 'stripe'
                ? notice(
                    'Stripe payments are confirmed automatically by the signed webhook. Only record a reference here if you have independently verified the payment in the Stripe dashboard.',
                    'warn'
                  )
                : ''
            }
            ${
              pending && order.payment_provider === 'stripe'
                ? `<form id="mark-paid-form" class="form-grid">
                     <div class="field">
                       <label for="payment-reference">Stripe reference</label>
                       <input id="payment-reference" name="reference" type="text" placeholder="cs_… or pi_…" required>
                     </div>
                     <div class="field">
                       <label for="payment-note">Internal note</label>
                       <input id="payment-note" name="note" type="text">
                     </div>
                     <div class="field field--full">
                       <button class="btn" type="submit" id="mark-paid-button">Record verified payment</button>
                     </div>
                   </form>`
                : ''
            }
            ${
              paid
                ? notice(
                    `Payment verified ${formatDateTime(order.paid_at)}. Stock has been committed and the order is ready for fulfilment.`,
                    'success'
                  )
                : ''
            }
            ${
              payments.length
                ? `<div class="table-wrap">
                     <table class="data-table" style="min-width:0">
                       <thead><tr><th>Provider</th><th>Reference</th><th>Amount</th><th>Status</th><th>When</th></tr></thead>
                       <tbody>
                         ${payments
                           .map(
                             (payment) => `<tr>
                               <td>${escapeHtml(payment.provider)}</td>
                               <td class="mono small">${escapeHtml(payment.provider_reference)}</td>
                               <td class="nowrap">${formatMoney(payment.amount_minor, payment.currency)}</td>
                               <td>${paymentBadge(payment.status)}</td>
                               <td class="small muted nowrap">${formatDateTime(payment.created_at)}</td>
                             </tr>`
                           )
                           .join('')}
                       </tbody>
                     </table>
                   </div>`
                : ''
            }
          </div>
        </section>

        <section class="card">
          <div class="card__head"><h3>Supplier fulfilment</h3><span class="badge badge--gold">Manual submission</span></div>
          <div class="card__body stack">
            ${notice(
              'Automated AW Dropship submission is not enabled. Place the order in the AW dashboard, then record the supplier reference here. Never submit an unpaid order.',
              ''
            )}
            ${
              order.payment_status !== 'paid'
                ? '<p class="small muted">This order cannot be submitted until payment is verified.</p>'
                : `<form id="supplier-submit-form" class="form-grid">
                     <div class="field">
                       <label for="external-order-id">AW order reference</label>
                       <input id="external-order-id" name="external_order_id" type="text" placeholder="Reference shown in AW Dropship">
                     </div>
                     <div class="field">
                       <label for="supplier-note">Note</label>
                       <input id="supplier-note" name="note" type="text" placeholder="Submitted by…">
                     </div>
                     <div class="field field--full">
                       <button class="btn" type="submit" id="supplier-submit-button">Record manual submission</button>
                     </div>
                   </form>`
            }
            ${
              supplierOrders.length
                ? `<div class="table-wrap">
                     <table class="data-table" style="min-width:0">
                       <thead><tr><th>Reference</th><th>Status</th><th>Tracking</th><th>Synced</th><th></th></tr></thead>
                       <tbody>
                         ${supplierOrders
                           .map(
                             (record) => `<tr>
                               <td class="mono small">${escapeHtml(record.external_order_id || record.external_reference)}</td>
                               <td>${escapeHtml(statusLabel(record.status))}${
                                 record.last_error
                                   ? `<span class="cell-sub" style="color:var(--danger)">${escapeHtml(
                                       record.last_error
                                     )}</span>`
                                   : ''
                               }</td>
                               <td class="small">${escapeHtml(record.tracking_number || '—')}${
                                 record.carrier ? `<span class="cell-sub">${escapeHtml(record.carrier)}</span>` : ''
                               }</td>
                               <td class="small muted nowrap">${formatDateTime(record.last_synced_at)}</td>
                               <td class="right"><button class="btn btn--ghost btn--sm" type="button" data-sync-supplier="${escapeHtml(
                                 record.id
                               )}">Poll status</button></td>
                             </tr>`
                           )
                           .join('')}
                       </tbody>
                     </table>
                   </div>`
                : '<p class="small muted">No supplier record yet.</p>'
            }
          </div>
        </section>

        <section class="card">
          <div class="card__head"><h3>Timeline</h3></div>
          <div class="card__body">
            ${
              events.length
                ? `<ol class="timeline">${events
                    .map(
                      (event) => `<li>
                        <div class="when">${formatDateTime(event.created_at)} · ${escapeHtml(event.actor)}</div>
                        <div class="what"><strong>${escapeHtml(statusLabel(event.event_type))}</strong>${
                          event.message ? `<br>${escapeHtml(event.message)}` : ''
                        }</div>
                      </li>`
                    )
                    .join('')}</ol>`
                : '<p class="small muted">No events recorded.</p>'
            }
          </div>
        </section>
      </div>

      <div class="order-side">
        <section class="card">
          <div class="card__head"><h3>Customer</h3></div>
          <div class="card__body stack">
            <div class="detail-list">
              <div class="row"><span>Email</span><span><a class="link" href="mailto:${escapeHtml(
                order.email
              )}">${escapeHtml(order.email)}</a></span></div>
              <div class="row"><span>Phone</span><span>${escapeHtml(order.phone || '—')}</span></div>
              <div class="row"><span>Delivery</span><span>${address
                .map(escapeHtml)
                .join('<br>')}</span></div>
              ${
                order.delivery_notes
                  ? `<div class="row"><span>Notes</span><span>${escapeHtml(order.delivery_notes)}</span></div>`
                  : ''
              }
              ${
                order.customer_notes
                  ? `<div class="row"><span>Customer note</span><span>${escapeHtml(order.customer_notes)}</span></div>`
                  : ''
              }
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card__head"><h3>Fulfilment actions</h3></div>
          <div class="card__body action-stack">
            <form id="status-form" class="stack">
              <div class="field">
                <label for="new-status">Update status</label>
                <select id="new-status" name="status">
                  ${selectOptions(
                    ORDER_STATUSES.filter(
                      (status) =>
                        !['pending_payment', 'cancelled', 'failed'].includes(status) &&
                        (status !== 'dispatched' || order.status === 'dispatched') &&
                        (status !== 'delivered' || Boolean(order.tracking_number) || order.status === 'delivered')
                    ),
                    order.status
                  )}
                </select>
              </div>
              <input class="input" name="note" type="text" placeholder="Internal note (optional)">
              <button class="btn btn--ghost" type="submit">Save status</button>
            </form>

            ${
              paid
                ? `<div class="divider"></div>
                   <form id="shipment-form" class="stack">
                     <p class="field-label">Record confirmed dispatch</p>
                     <input class="input" name="carrier" type="text" placeholder="Carrier" value="${escapeHtml(
                       order.carrier || ''
                     )}">
                     <input class="input" name="tracking_number" type="text" placeholder="Tracking number" value="${escapeHtml(
                       order.tracking_number || ''
                     )}">
                     <input class="input" name="tracking_url" type="url" placeholder="Tracking URL (https://…)" value="${escapeHtml(
                       order.tracking_url || ''
                     )}">
                     <button class="btn btn--ghost" type="submit">Confirm dispatch</button>
                   </form>`
                : ''
            }

            <div class="divider"></div>
            <form id="cancel-form" class="stack">
              <p class="field-label">Cancel order</p>
              <input class="input" name="reason" type="text" placeholder="Reason (shown to customer)">
              <button class="btn btn--danger" type="submit" ${
                ['cancelled', 'delivered'].includes(order.status) ? 'disabled' : ''
              }>Cancel order</button>
            </form>
          </div>
        </section>

        <section class="card">
          <div class="card__head"><h3>Admin notes</h3></div>
          <div class="card__body">
            <form id="notes-form" class="stack">
              <textarea class="input" name="admin_notes" rows="5" placeholder="Internal notes, not visible to the customer">${escapeHtml(
                order.admin_notes || ''
              )}</textarea>
              <button class="btn btn--ghost" type="submit">Save notes</button>
            </form>
          </div>
        </section>
      </div>
    </div>`;

  async function run(button, label, fn) {
    setBusy(button, true, label);
    try {
      await fn();
      toast('Saved.', 'success');
      context.refresh();
    } catch (error) {
      toast(error.message, 'error');
      setBusy(button, false);
    }
  }

  view.querySelector('#mark-paid-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    run(button, 'Recording…', () =>
      adminApi(`/orders/${id}`, {
        method: 'POST',
        body: {
          action: 'mark_paid',
          reference: form.elements.reference.value.trim(),
          note: form.elements.note.value.trim()
        }
      })
    );
  });

  view.querySelector('#status-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    run(button, 'Saving…', () =>
      adminApi(`/orders/${id}`, {
        method: 'POST',
        body: {
          action: 'update_status',
          status: form.elements.status.value,
          note: form.elements.note.value.trim()
        }
      })
    );
  });

  view.querySelector('#shipment-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    run(button, 'Recording…', () =>
      adminApi(`/orders/${id}`, {
        method: 'POST',
        body: {
          action: 'record_shipment',
          carrier: form.elements.carrier.value.trim(),
          tracking_number: form.elements.tracking_number.value.trim(),
          tracking_url: form.elements.tracking_url.value.trim()
        }
      })
    );
  });

  view.querySelector('#cancel-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = form.elements.reason.value.trim();
    if (!reason) {
      toast('Enter a cancellation reason.', 'error');
      return;
    }
    if (!window.confirm('Cancel this order and release or restore stock?')) return;
    const button = form.querySelector('button[type="submit"]');
    run(button, 'Cancelling…', () =>
      adminApi(`/orders/${id}`, { method: 'POST', body: { action: 'cancel', reason } })
    );
  });

  view.querySelector('#supplier-submit-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    if (!window.confirm('Confirm this order was placed in AW Dropship?')) return;
    run(button, 'Recording…', () =>
      adminApi(`/orders/${id}`, {
        method: 'POST',
        body: {
          action: 'submit_supplier',
          external_order_id: form.elements.external_order_id.value.trim(),
          note: form.elements.note.value.trim()
        }
      })
    );
  });

  view.querySelectorAll('[data-sync-supplier]').forEach((button) => {
    button.addEventListener('click', () => {
      run(button, 'Polling…', () =>
        adminApi(`/orders/${id}`, {
          method: 'POST',
          body: { action: 'sync_supplier', supplier_order_id: button.dataset.syncSupplier }
        })
      );
    });
  });

  view.querySelector('#notes-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    run(button, 'Saving…', () =>
      adminApi(`/orders/${id}`, {
        method: 'PATCH',
        body: { admin_notes: form.elements.admin_notes.value }
      })
    );
  });
}
