import { initLayout } from '/shared/js/layout.js';
import { supabase } from '/shared/js/supabase.js';
import { requireAuth, getProfile, signOut } from '/shared/js/auth.js';
import { formatMoney } from '/shared/js/money.js';
import { setMeta } from '/shared/js/seo.js';
import { qs, qsa, escapeHtml, toast, setBusy } from '/shared/js/dom.js';

const STATUS_LABELS = {
  pending_payment: { text: 'Pending payment', className: 'status-pill--pending' },
  paid: { text: 'Paid', className: 'status-pill--paid' },
  awaiting_supplier: { text: 'Preparing', className: 'status-pill--paid' },
  submitted_to_supplier: { text: 'With supplier', className: 'status-pill--paid' },
  supplier_processing: { text: 'Being prepared', className: 'status-pill--paid' },
  dispatched: { text: 'Dispatched', className: 'status-pill--dispatch' },
  delivered: { text: 'Delivered', className: 'status-pill--delivered' },
  cancelled: { text: 'Cancelled', className: 'status-pill--cancelled' },
  failed: { text: 'Needs attention', className: 'status-pill--failed' }
};

const EVENT_LABELS = {
  order_created: 'Order placed',
  payment_confirmed: 'Payment confirmed',
  status_changed: 'Status updated',
  shipment_confirmed: 'Dispatched',
  order_cancelled: 'Order cancelled',
  release_failed: 'Reservation release failed'
};

let user;

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function showError(message) {
  const box = qs('#account-error');
  box.textContent = message;
  box.hidden = false;
}

async function loadOrders() {
  const list = qs('#orders-list');
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, order_number, status, payment_status, fulfilment_status, total_minor, currency, placed_at, tracking_number, tracking_url, carrier, order_items ( id, name, variant_name, quantity, line_total_minor, sku )'
    )
    .eq('user_id', user.id)
    .order('placed_at', { ascending: false });

  if (error) {
    list.innerHTML = `<p class="muted">We could not load your orders just now. (${escapeHtml(error.message)})</p>`;
    return;
  }

  if (!data.length) {
    list.innerHTML = `
      <div class="empty-state" style="text-align:left;padding-block:2rem">
        <p class="muted">You have not placed an order yet.</p>
        <a class="btn btn--outline" href="/shop" style="margin-top:1.25rem">Browse the collection</a>
      </div>`;
    return;
  }

  list.innerHTML = data
    .map((order) => {
      const status = STATUS_LABELS[order.status] ?? { text: order.status, className: '' };
      return `
        <div class="order-row" data-order="${order.id}">
          <div>
            <p style="font-family:var(--font-display);font-size:1.05rem">${escapeHtml(order.order_number)}</p>
            <div class="order-row__meta">
              <span>${formatDate(order.placed_at)}</span>
              <span>${order.order_items?.length ?? 0} ${(order.order_items?.length ?? 0) === 1 ? 'item' : 'items'}</span>
              <span>${formatMoney(order.total_minor, order.currency)}</span>
              <span>Payment: ${escapeHtml(order.payment_status)}</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:1rem">
            <span class="status-pill ${status.className}">${escapeHtml(status.text)}</span>
            <button class="link-underline" type="button" data-view="${order.id}" style="border:0;background:none;padding:0">View</button>
          </div>
          <div id="order-detail-${order.id}" style="display:none;grid-column:1/-1;padding-top:1rem"></div>
        </div>`;
    })
    .join('');

  qsa('[data-view]', list).forEach((button) => {
    button.addEventListener('click', () => toggleOrder(button.dataset.view, button));
  });
}

async function toggleOrder(orderId, button) {
  const panel = qs(`#order-detail-${orderId}`);
  if (!panel) return;

  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    button.textContent = 'View';
    return;
  }

  button.disabled = true;
  panel.style.display = 'block';
  panel.innerHTML = '<div class="skeleton" style="height:60px"></div>';

  const { data: order, error } = await supabase
    .from('orders')
    .select(
      'id, order_number, status, payment_status, fulfilment_status, subtotal_minor, shipping_minor, total_minor, currency, placed_at, paid_at, dispatched_at, tracking_number, tracking_url, carrier, email, shipping_name, shipping_line1, shipping_line2, shipping_city, shipping_region, shipping_postcode, shipping_country'
    )
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: events } = await supabase
    .from('order_events')
    .select('event_type, message, created_at, to_status')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  const { data: items } = await supabase
    .from('order_items')
    .select('id, name, variant_name, quantity, line_total_minor, sku')
    .eq('order_id', orderId);

  if (error || !order) {
    panel.innerHTML = `<p class="muted">Order details could not be loaded.</p>`;
    button.disabled = false;
    return;
  }

  panel.innerHTML = `
    <div class="summary" style="position:static;background:var(--surface);border:1px solid var(--line);padding:1.25rem">
      <div style="margin-bottom:1rem">
        ${(items ?? [])
          .map(
            (item) => `
          <div class="review-line">
            <span>${escapeHtml(item.name)}${item.variant_name ? ` — ${escapeHtml(item.variant_name)}` : ''} × ${item.quantity}</span>
            <span>${formatMoney(item.line_total_minor, order.currency)}</span>
          </div>`
          )
          .join('')}
        <div class="review-line muted"><span>Delivery</span><span>${order.shipping_minor === 0 ? 'Included' : formatMoney(order.shipping_minor, order.currency)}</span></div>
        <div class="summary__total"><span>Total</span><span>${formatMoney(order.total_minor, order.currency)}</span></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;font-size:.84rem;border-top:1px solid var(--line);padding-top:1rem">
        <div>
          <p class="small muted" style="text-transform:uppercase;letter-spacing:.1em;font-size:.66rem">Delivery address</p>
          <p style="margin-top:.4rem;line-height:1.7">
            ${[
              order.shipping_name,
              order.shipping_line1,
              order.shipping_line2,
              order.shipping_city,
              order.shipping_region,
              order.shipping_postcode,
              order.shipping_country
            ]
              .filter(Boolean)
              .map(escapeHtml)
              .join('<br>')}
          </p>
        </div>
        <div>
          <p class="small muted" style="text-transform:uppercase;letter-spacing:.1em;font-size:.66rem">Status history</p>
          <ul style="margin-top:.4rem">
            ${(events ?? [])
              .map(
                (event) => `<li style="margin-bottom:.35rem">
                  <span class="muted">${formatDate(event.created_at)}</span> — ${escapeHtml(
                    EVENT_LABELS[event.event_type] || event.event_type
                  )}${event.to_status ? ` (${escapeHtml(event.to_status.replaceAll('_', ' '))})` : ''}
                </li>`
              )
              .join('')}
          </ul>
        </div>
      </div>

      ${
        order.tracking_number
          ? `<div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--line);font-size:.84rem">
               <p class="small muted" style="text-transform:uppercase;letter-spacing:.1em;font-size:.66rem">Tracking</p>
               <p style="margin-top:.4rem">${escapeHtml(order.carrier || '')} ${escapeHtml(order.tracking_number)}${
                 order.tracking_url
                   ? ` — <a href="${escapeHtml(order.tracking_url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">Track parcel</a>`
                   : ''
               }</p>
             </div>`
          : `<p class="small muted" style="margin-top:1rem">Tracking appears here once dispatch is confirmed.</p>`
      }
    </div>`;

  panel.style.display = 'block';
  button.textContent = 'Hide';
  button.disabled = false;
}

function switchTab(tab) {
  const target = tab === 'details' ? 'details' : 'orders';
  qsa('[data-tab]').forEach((link) => link.setAttribute('aria-current', String(link.dataset.tab === target)));
  qs('#panel-orders').hidden = target !== 'orders';
  qs('#panel-details').hidden = target !== 'details';
  history.replaceState({}, '', `#${target}`);
}

async function loadProfile() {
  const profile = await getProfile();
  qs('#full_name').value = profile?.full_name ?? '';
  qs('#phone').value = profile?.phone ?? '';
  qs('#email-readonly').value = profile?.email ?? user.email ?? '';
  qs('#account-email').textContent = profile?.email ?? user.email ?? '';
  const first = (profile?.full_name || '').split(' ')[0];
  qs('#account-greeting').textContent = first ? `Good to see you, ${first}.` : 'My Account';
}

async function init() {
  await initLayout();
  setMeta({ title: 'My Account | Hasswell London', noindex: true, path: '/account' });

  user = await requireAuth('/account');
  if (!user) return;

  await loadProfile();
  await loadOrders();

  if (new URLSearchParams(window.location.search).get('recovery') === '1') {
    qs('#recovery-panel').hidden = false;
    switchTab('details');
    qs('#new-password').focus();
  }

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      qs('#recovery-panel').hidden = false;
      switchTab('details');
    }
  });

  qsa('[data-tab]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      switchTab(link.dataset.tab);
    });
  });

  switchTab(window.location.hash.replace('#', '') || 'orders');

  qs('#details-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    setBusy(button, true, 'Saving…');
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: qs('#full_name').value.trim(),
        phone: qs('#phone').value.trim()
      })
      .eq('id', user.id);
    setBusy(button, false);
    if (error) {
      showError(error.message);
      return;
    }
    toast('Your details have been saved.', 'success');
    await loadProfile();
  });

  qs('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    const password = qs('#new-password').value;
    if (password.length < 8) {
      toast('Use a password of at least 8 characters.', 'error');
      return;
    }
    setBusy(button, true, 'Updating…');
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(button, false);
    if (error) {
      toast(error.message, 'error');
      return;
    }
    qs('#new-password').value = '';
    qs('#recovery-panel').hidden = true;
    toast('Your password has been updated.', 'success');
  });

  qs('#sign-out').addEventListener('click', async () => {
    await signOut();
    window.location.assign('/');
  });
}

init().catch((error) => console.error('[account]', error));
