import { initLayout } from '/shared/js/layout.js';
import { cart } from '/shared/js/cart.js';
import { apiFetch } from '/shared/js/api.js';
import { formatMoney } from '/shared/js/money.js';
import { setMeta, trackEvent } from '/shared/js/seo.js';
import { getUser, getProfile } from '/shared/js/auth.js';
import { qs, qsa, escapeHtml, toast, setBusy } from '/shared/js/dom.js';

const IDEMPOTENCY_STORAGE = 'hl_checkout_key';

const state = {
  validated: null,
  config: null,
  details: null,
  step: 1,
  submitting: false
};

function newIdempotencyKey() {
  const key = crypto.randomUUID();
  sessionStorage.setItem(IDEMPOTENCY_STORAGE, key);
  return key;
}

function getCheckoutPayload() {
  return cart.get().items.map((item) => ({
    product_id: item.productId,
    variant_id: item.variantId,
    quantity: item.quantity
  }));
}

function showError(message) {
  const box = qs('#checkout-error');
  box.textContent = message;
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearError() {
  qs('#checkout-error').hidden = true;
}

function renderSummary() {
  const items = cart.get().items;
  const currency = state.validated?.currency || 'GBP';

  qs('#summary-items').innerHTML = items
    .map(
      (item) => `
      <div class="between" style="align-items:flex-start;gap:1rem;padding:.55rem 0;border-bottom:1px solid var(--line)">
        <div style="display:flex;gap:.75rem;min-width:0">
          <div style="width:48px;flex:none;aspect-ratio:4/5;background:var(--sand);overflow:hidden">
            <img src="${escapeHtml(item.image)}" alt="" width="100" height="125" style="width:100%;height:100%;object-fit:cover">
          </div>
          <div style="min-width:0">
            <p style="font-size:.86rem;line-height:1.3">${escapeHtml(item.name)}</p>
            ${item.variantName ? `<p class="small muted">${escapeHtml(item.variantName)}</p>` : ''}
            <p class="small muted">Qty ${item.quantity}</p>
          </div>
        </div>
        <span class="small" style="white-space:nowrap">${formatMoney(item.unitPrice * item.quantity, currency)}</span>
      </div>`
    )
    .join('');

  const subtotal = state.validated?.subtotal_minor ?? cart.get().subtotal;
  const shipping = state.validated?.shipping_minor ?? 0;
  const total = state.validated?.total_minor ?? subtotal;

  qs('#summary-rows').innerHTML = `
    <div class="summary__row"><span>Subtotal</span><span>${formatMoney(subtotal, currency)}</span></div>
    <div class="summary__row"><span>Delivery</span><span>${shipping === 0 ? 'Included' : formatMoney(shipping, currency)}</span></div>
  `;
  qs('#summary-total').textContent = formatMoney(total, currency);
  qs('#summary-note').textContent = 'Prices and stock are confirmed by our server when you place the order.';

  const methodPrice = shipping === 0 ? 'Included' : formatMoney(shipping, currency);
  qs('#delivery-method-price').textContent = methodPrice;
  qs('#delivery-method-note').textContent =
    state.config?.shipping_note || 'Delivery options and charges are confirmed before payment.';
}

function renderPaymentNote() {
  const provider = state.config?.payment_provider;
  const text = qs('#payment-note-text');
  const button = qs('#place-order');
  const note = qs('#payment-note');

  if (provider === 'stripe') {
    text.textContent =
      'You will be redirected to our secure card payment provider to complete payment. Card details never touch our servers.';
    button.textContent = 'Pay now';
    note.className = 'notice';
  } else if (provider === 'manual') {
    text.textContent =
      'Your order will be reserved and payment instructions will be shown on the confirmation page. We only dispatch after payment is verified.';
    button.textContent = 'Place order';
    note.className = 'notice notice--warn';
  } else {
    text.textContent =
      'Payments are not configured yet. Please do not place an order until the store owner has connected a payment provider.';
    button.disabled = true;
    note.className = 'notice notice--error';
  }
}

function validateDetails(values) {
  const errors = {};
  if (!values.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (!values.phone || values.phone.replace(/\D/g, '').length < 7) {
    errors.phone = 'Enter a phone number so the courier can reach you.';
  }
  if (!values.shipping_name || values.shipping_name.length < 2) {
    errors.shipping_name = 'Enter the recipient’s full name.';
  }
  if (!values.shipping_line1) errors.shipping_line1 = 'Enter the first line of the address.';
  if (!values.shipping_city) errors.shipping_city = 'Enter a town or city.';
  if (!values.shipping_postcode) {
    errors.shipping_postcode = 'Enter a postcode.';
  } else if (values.shipping_country === 'GB') {
    const normalised = values.shipping_postcode.toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(normalised)) {
      errors.shipping_postcode = 'Enter a valid UK postcode.';
    }
  }
  return errors;
}

function showFieldErrors(errors) {
  qsa('.field').forEach((field) => field.classList.remove('has-error'));
  qsa('.field .error').forEach((span) => (span.textContent = ''));
  for (const [name, message] of Object.entries(errors)) {
    const input = qs(`[name="${name}"]`);
    const error = qs(`#${name}-error`);
    input?.closest('.field')?.classList.add('has-error');
    if (error) error.textContent = message;
  }
  const first = qs('.field.has-error input, .field.has-error select, .field.has-error textarea');
  first?.focus();
}

function readDetails() {
  const form = qs('#details-form');
  const data = Object.fromEntries(new FormData(form).entries());
  return {
    email: data.email?.trim() ?? '',
    phone: data.phone?.trim() ?? '',
    shipping_name: data.shipping_name?.trim() ?? '',
    shipping_line1: data.shipping_line1?.trim() ?? '',
    shipping_line2: data.shipping_line2?.trim() ?? '',
    shipping_city: data.shipping_city?.trim() ?? '',
    shipping_region: data.shipping_region?.trim() ?? '',
    shipping_postcode: data.shipping_postcode?.trim().toUpperCase() ?? '',
    shipping_country: data.shipping_country || 'GB',
    delivery_notes: data.delivery_notes?.trim() ?? ''
  };
}

function goToReview() {
  clearError();
  const details = readDetails();
  const errors = validateDetails(details);
  if (Object.keys(errors).length) {
    showFieldErrors(errors);
    return;
  }
  showFieldErrors({});
  state.details = details;
  state.step = 2;

  const addressLines = [
    details.shipping_name,
    details.shipping_line1,
    details.shipping_line2,
    details.shipping_city,
    details.shipping_region,
    details.shipping_postcode,
    countryName(details.shipping_country)
  ].filter(Boolean);

  qs('#review-address').innerHTML = addressLines.map(escapeHtml).join('<br>');
  qs('#review-contact').textContent = `${details.email} · ${details.phone}`;
  if (details.delivery_notes) {
    qs('#review-contact').textContent += ` · Note: ${details.delivery_notes}`;
  }

  qs('#review-items').innerHTML = cart
    .get()
    .items.map(
      (item) => `
      <div class="review-line">
        <span>${escapeHtml(item.name)}${item.variantName ? ` — ${escapeHtml(item.variantName)}` : ''} × ${item.quantity}</span>
        <span>${formatMoney(item.unitPrice * item.quantity, item.currency)}</span>
      </div>`
    )
    .join('');

  qs('#details-form').hidden = true;
  qs('#review-step').hidden = false;
  qs('#step-indicator').textContent = 'Step 2 of 2 — Review and pay';
  renderSummary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function countryName(code) {
  try {
    return new Intl.DisplayNames(['en-GB'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

async function placeOrder() {
  if (state.submitting) return;
  if (!qs('#terms').checked) {
    qs('#terms-error').textContent = 'Please accept the terms to continue.';
    qs('#terms').focus();
    return;
  }
  qs('#terms-error').textContent = '';
  clearError();

  const button = qs('#place-order');
  state.submitting = true;
  setBusy(button, true, 'Creating your order…');

  try {
    const idempotencyKey = sessionStorage.getItem(IDEMPOTENCY_STORAGE) || newIdempotencyKey();
    const payload = {
      items: getCheckoutPayload(),
      customer: state.details,
      customer_notes: '',
      delivery_notes: state.details.delivery_notes,
      terms_accepted: true
    };

    const result = await apiFetch('/api/checkout/create-order', {
      method: 'POST',
      body: payload,
      idempotencyKey
    });

    sessionStorage.removeItem(IDEMPOTENCY_STORAGE);
    cart.clear();

    trackEvent('purchase', {
      transaction_id: result.order_number,
      currency: result.currency || 'GBP',
      value: (result.total_minor || 0) / 100,
      items: payload.items
    });

    const confirmationUrl = `/order-confirmation?order=${encodeURIComponent(
      result.order_number
    )}&token=${encodeURIComponent(result.access_token)}`;

    if (result.payment?.redirect_url) {
      sessionStorage.setItem('hl_pending_order', confirmationUrl);
      window.location.assign(result.payment.redirect_url);
      return;
    }

    window.location.assign(confirmationUrl);
  } catch (error) {
    console.error('[checkout]', error);
    const messages = {
      INSUFFICIENT_STOCK: 'One of the pieces in your bag is no longer available in that quantity. Return to your bag to adjust it.',
      PRODUCT_UNAVAILABLE: 'One of the pieces in your bag is no longer available. Return to your bag to remove it.',
      CART_EMPTY: 'Your bag is empty.',
      INVALID_ADDRESS: 'Please check the delivery address and try again.',
      INVALID_EMAIL: 'Please check your email address.',
      PAYMENT_PROVIDER_UNAVAILABLE:
        'Payments are not available at the moment, so no order was placed. Your card has not been charged.',
      PAYMENT_INIT_FAILED:
        'Your order was reserved but the payment page could not be opened. Do not pay again — contact us with your order number.'
    };
    showError(messages[error.code] || error.message || 'We could not place your order. Please try again.');
    setBusy(button, false);
    state.submitting = false;
    return;
  }

  setBusy(button, false);
  state.submitting = false;
}

async function prefillAccount() {
  try {
    const user = await getUser();
    if (!user) return;
    const profile = await getProfile();
    qs('#email').value = user.email ?? '';
    if (profile?.full_name) qs('#shipping_name').value = profile.full_name;
    if (profile?.phone) qs('#phone').value = profile.phone;
  } catch (error) {
    console.warn('[checkout] prefill:', error.message);
  }
}

async function init() {
  await initLayout();
  setMeta({ title: 'Checkout | Hasswell London', noindex: true, path: '/checkout' });

  if (!cart.get().items.length) {
    window.location.replace('/cart');
    return;
  }

  qs('#place-order').disabled = true;

  const [configResult, validationResult] = await Promise.allSettled([
    apiFetch('/api/store/config'),
    apiFetch('/api/cart/validate', { method: 'POST', body: { items: getCheckoutPayload() } })
  ]);

  if (configResult.status === 'fulfilled') {
    state.config = configResult.value;
  } else {
    state.config = { payment_provider: null, shipping_countries: ['GB'] };
    showError('The store configuration could not be loaded. Please refresh or contact us.');
  }

  if (validationResult.status === 'fulfilled') {
    state.validated = validationResult.value;
    if (validationResult.value.issues?.length) {
      const box = document.createElement('div');
      box.className = 'notice notice--warn';
      box.style.marginBottom = '1.5rem';
      box.innerHTML = validationResult.value.issues.map((issue) => `<p>${escapeHtml(issue.message)}</p>`).join('');
      qs('#details-form').before(box);
    }
  } else {
    showError(
      'We could not confirm stock for your bag. Please return to your bag and try again before paying.'
    );
  }

  // Country selector is driven by the store's configured delivery regions.
  const countries = state.config?.shipping_countries?.length ? state.config.shipping_countries : ['GB'];
  qs('#shipping_country').innerHTML = countries
    .map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(countryName(code))}</option>`)
    .join('');
  if (countries.length === 1) {
    qs('#shipping_country').value = countries[0];
  }
  if (countries.length > 1) {
    qs('#delivery-region-note').textContent = 'Choose the country for delivery.';
  }

  renderSummary();
  renderPaymentNote();
  await prefillAccount();

  qs('#details-form').addEventListener('submit', (event) => {
    event.preventDefault();
    goToReview();
  });
  qs('#edit-details').addEventListener('click', () => {
    state.step = 1;
    qs('#review-step').hidden = true;
    qs('#details-form').hidden = false;
    qs('#step-indicator').textContent = 'Step 1 of 2 — Delivery details';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  qs('#back-to-details').addEventListener('click', () => qs('#edit-details').click());
  qs('#place-order').addEventListener('click', placeOrder);

  qsa('#details-form input, #details-form select, #details-form textarea').forEach((input) => {
    input.addEventListener('input', () => {
      input.closest('.field')?.classList.remove('has-error');
      const error = qs(`#${input.name}-error`);
      if (error) error.textContent = '';
    });
  });

  // Re-validate if the cart changed in another tab.
  cart.onChange(() => {
    if (!cart.get().items.length) window.location.replace('/cart');
  });
}

init().catch((error) => {
  console.error('[checkout] init', error);
  showError('Checkout could not be initialised. Please refresh the page.');
});
