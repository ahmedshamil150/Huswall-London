import { initLayout } from '/shared/js/layout.js';
import { apiFetch } from '/shared/js/api.js';
import { formatMoney } from '/shared/js/money.js';
import { setMeta } from '/shared/js/seo.js';
import { qs, escapeHtml, setBusy, toast } from '/shared/js/dom.js';

const params = new URLSearchParams(window.location.search);
const orderNumber = params.get('order');
const token = params.get('token');

let pollTimer = null;
let attempts = 0;

const STATUS_COPY = {
  pending_payment: {
    title: 'Order received',
    body: 'We are waiting for your payment to be confirmed. This page updates automatically.'
  },
  paid: {
    title: 'Payment confirmed',
    body: 'Thank you. Your order is confirmed and is being prepared.'
  },
  awaiting_supplier: {
    title: 'Payment confirmed',
    body: 'Thank you. Your order is confirmed and is being prepared for dispatch.'
  },
  submitted_to_supplier: {
    title: 'Order in progress',
    body: 'Your order has been passed to our fulfilment partner. We will email you again when it is on its way.'
  },
  supplier_processing: {
    title: 'Order in progress',
    body: 'Your order is being prepared. We will email you again when it is on its way.'
  },
  dispatched: {
    title: 'On its way',
    body: 'Your order has been dispatched. Tracking details are below.'
  },
  delivered: {
    title: 'Delivered',
    body: 'Your order has been delivered.'
  },
  cancelled: {
    title: 'Order cancelled',
    body: 'This order has been cancelled. If a payment was taken, any refund will be confirmed by email.'
  },
  failed: {
    title: 'Order needs attention',
    body: 'Something went wrong with this order. Our team has been notified — please contact us before paying again.'
  }
};

function renderLoading(message) {
  qs('#confirmation-root').innerHTML = `
    <span class="eyebrow">Order</span>
    <h1 style="margin-top:1rem">${escapeHtml(message)}</h1>
    <p class="lede" style="margin-top:1rem">This page will update automatically.</p>`;
}

function renderFatal(message) {
  qs('#confirmation-root').innerHTML = `
    <span class="eyebrow">Order lookup</span>
    <h1 style="margin-top:1rem">We could not load that order.</h1>
    <p class="lede" style="margin-top:1rem">${escapeHtml(message)}</p>
    <div class="cluster" style="margin-top:2rem">
      <a class="btn" href="/account">Go to my account</a>
      <a class="btn btn--outline" href="/contact">Contact us</a>
    </div>`;
}

function renderOrder(order) {
  const copy = STATUS_COPY[order.status] ?? STATUS_COPY.pending_payment;
  const isPending = order.payment_status === 'pending' && order.status === 'pending_payment';
  const manual = order.payment?.provider === 'manual' && isPending;
  const hasTracking = Boolean(order.tracking?.number);

  qs('#confirmation-root').innerHTML = `
    <span class="eyebrow">Order ${escapeHtml(order.order_number)}</span>
    <h1 style="margin-top:1rem">${escapeHtml(copy.title)}</h1>
    <p class="lede" style="margin-top:1rem;max-width:52ch">${escapeHtml(copy.body)}</p>

    ${
      isPending
        ? `<div class="notice notice--warn" style="margin-top:2rem">
             <p><strong>Payment status: pending.</strong> We will not dispatch this order until payment is verified.</p>
           </div>`
        : order.payment_status === 'paid'
          ? `<div class="notice notice--success" style="margin-top:2rem">
               <p>Payment verified on ${new Date(order.paid_at || order.created_at).toLocaleDateString('en-GB', {
                 day: 'numeric',
                 month: 'long',
                 year: 'numeric'
               })}.</p>
             </div>`
          : ''
    }

    ${
      manual && order.payment?.instructions
        ? `<section class="summary" style="position:static;margin-top:2rem">
             <h2>How to pay</h2>
             <div class="small" style="margin-top:1rem;line-height:1.9">
               ${order.payment.instructions
                 .split('\n')
                 .map((line) => `<p>${escapeHtml(line)}</p>`)
                 .join('')}
             </div>
             <p class="small muted" style="margin-top:1rem">Use <strong>${escapeHtml(
               order.order_number
             )}</strong> as your payment reference. Your order is reserved, but will be released if payment is not received.</p>
           </section>`
        : ''
    }

    ${
      isPending && order.payment?.provider === 'stripe'
        ? `<div class="cluster" style="margin-top:1.75rem">
             <button class="btn" type="button" id="retry-payment">Complete payment</button>
             <span class="small muted">Your order is reserved while you complete payment.</span>
           </div>`
        : ''
    }

    ${
      hasTracking
        ? `<section class="summary" style="position:static;margin-top:2rem">
             <h2>Tracking</h2>
             <div class="small" style="margin-top:.85rem;line-height:1.9">
               <p>Carrier: ${escapeHtml(order.tracking.carrier || '—')}</p>
               <p>Tracking number: ${escapeHtml(order.tracking.number)}</p>
               ${
                 order.tracking.url
                   ? `<p><a href="${escapeHtml(order.tracking.url)}" rel="noopener noreferrer" target="_blank" style="text-decoration:underline">Track your parcel</a></p>`
                   : ''
               }
             </div>
           </section>`
        : ''
    }

    <section style="margin-top:2.5rem">
      <h2 style="font-family:var(--font-body);font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;font-weight:600">Items</h2>
      <div style="margin-top:1rem">
        ${(order.items ?? [])
          .map(
            (item) => `
          <div class="review-line">
            <span>${escapeHtml(item.name)}${item.variant_name ? ` — ${escapeHtml(item.variant_name)}` : ''} × ${item.quantity}</span>
            <span>${formatMoney(item.line_total_minor, order.currency)}</span>
          </div>`
          )
          .join('')}
        <div class="review-line" style="margin-top:.75rem;color:var(--muted)">
          <span>Delivery</span>
          <span>${order.shipping_minor === 0 ? 'Included' : formatMoney(order.shipping_minor, order.currency)}</span>
        </div>
        <div class="summary__total"><span>Total</span><span>${formatMoney(order.total_minor, order.currency)}</span></div>
      </div>
    </section>

    <section style="margin-top:2.5rem">
      <h2 style="font-family:var(--font-body);font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;font-weight:600">Delivery address</h2>
      <p class="small" style="margin-top:.85rem;line-height:1.8">
        ${[
          order.shipping.name,
          order.shipping.line1,
          order.shipping.line2,
          order.shipping.city,
          order.shipping.region,
          order.shipping.postcode,
          order.shipping.country
        ]
          .filter(Boolean)
          .map(escapeHtml)
          .join('<br>')}
      </p>
      <p class="small muted" style="margin-top:.5rem">${escapeHtml(order.email)}</p>
    </section>

    <div class="cluster" style="margin-top:3rem">
      <a class="btn btn--outline" href="/shop">Continue shopping</a>
      <a class="link-underline" href="/account">View my account</a>
    </div>

    <p class="small muted" style="margin-top:2rem">
      Keep this page — it is the private link to your order. A confirmation email is sent when payment is verified.
    </p>
  `;

  qs('#retry-payment')?.addEventListener('click', retryPayment);
}

async function load({ silent = false } = {}) {
  if (!orderNumber || !token) {
    renderFatal('The order link is incomplete. Use the link from your confirmation email or sign in to your account.');
    return;
  }

  if (!silent) renderLoading('Retrieving your order…');

  try {
    const data = await apiFetch(
      `/api/orders/status?order=${encodeURIComponent(orderNumber)}&token=${encodeURIComponent(token)}`
    );
    renderOrder(data.order);

    // Poll while payment is still pending (webhooks can arrive a moment later).
    if (data.order.payment_status === 'pending' && data.order.status === 'pending_payment' && attempts < 24) {
      attempts += 1;
      clearTimeout(pollTimer);
      pollTimer = setTimeout(() => load({ silent: true }), 5000);
    }
  } catch (error) {
    renderFatal(error.message);
  }
}

async function retryPayment() {
  const button = qs('#retry-payment');
  if (!button) return;
  setBusy(button, true, 'Opening payment…');
  try {
    const result = await apiFetch('/api/checkout/retry-payment', {
      method: 'POST',
      body: { order_number: orderNumber, token }
    });
    if (result.redirect_url) window.location.assign(result.redirect_url);
    else throw new Error('No payment page was returned.');
  } catch (error) {
    toast(error.message, 'error');
    setBusy(button, false);
  }
}

async function init() {
  await initLayout();
  setMeta({ title: 'Order Confirmation | Hasswell London', noindex: true, path: '/order-confirmation' });

  // Returning from a hosted payment page: resume polling immediately.
  sessionStorage.removeItem('hl_pending_order');
  load();
}

init().catch((error) => console.error('[confirmation]', error));
