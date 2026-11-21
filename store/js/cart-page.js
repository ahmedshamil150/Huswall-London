import { initLayout } from '/shared/js/layout.js';
import { cart, lineKey } from '/shared/js/cart.js';
import { apiFetch } from '/shared/js/api.js';
import { formatMoney } from '/shared/js/money.js';
import { setMeta } from '/shared/js/seo.js';
import { qs, qsa, escapeHtml, toast, debounce, icons } from '/shared/js/dom.js';

let validation = null;
let validating = false;

function payloadFromCart() {
  return cart.get().items.map((item) => ({
    product_id: item.productId,
    variant_id: item.variantId,
    quantity: item.quantity
  }));
}

function stockNote(available) {
  if (available === null || available === undefined) return '';
  if (available === 0) return '<span class="product-card__stock is-out">Out of stock</span>';
  if (available <= 3) return `<span class="product-card__stock is-low">Only ${available} left</span>`;
  return '';
}

function renderItems() {
  const container = qs('#cart-items');
  const { items } = cart.get();

  if (!items.length) {
    qs('#cart-root').hidden = true;
    qs('#cart-empty').hidden = false;
    qs('#checkout-link').setAttribute('aria-disabled', 'true');
    return;
  }

  qs('#cart-root').hidden = false;
  qs('#cart-empty').hidden = true;

  container.innerHTML = items
    .map((item) => {
      const line = validation?.items?.find(
        (entry) =>
          entry.product_id === item.productId && (entry.variant_id || null) === (item.variantId || null)
      );
      const available = line?.available ?? null;
      const href = `/product/${encodeURIComponent(item.slug)}`;
      return `
        <div class="cart-item" data-key="${escapeHtml(lineKey(item.productId, item.variantId))}">
          <a class="cart-item__media" href="${href}" tabindex="-1" aria-hidden="true">
            <img src="${escapeHtml(line?.image || item.image)}" alt="" width="200" height="250" loading="lazy">
          </a>
          <div>
            <a class="cart-item__title" href="${href}">${escapeHtml(line?.name || item.name)}</a>
            ${item.variantName ? `<p class="cart-item__variant">${escapeHtml(item.variantName)}</p>` : ''}
            ${stockNote(available)}
            <div class="cart-item__controls">
              <div class="qty">
                <button type="button" data-qty="-1" data-key="${escapeHtml(lineKey(item.productId, item.variantId))}" aria-label="Decrease quantity">−</button>
                <input type="number" value="${item.quantity}" min="1" max="${Math.max(1, Math.min(available ?? 99, 99))}"
                       data-key="${escapeHtml(lineKey(item.productId, item.variantId))}" aria-label="Quantity for ${escapeHtml(item.name)}">
                <button type="button" data-qty="1" data-key="${escapeHtml(lineKey(item.productId, item.variantId))}" aria-label="Increase quantity">+</button>
              </div>
              <button class="cart-item__remove" type="button" data-remove="${escapeHtml(lineKey(item.productId, item.variantId))}">Remove</button>
            </div>
          </div>
          <div class="cart-item__price">${formatMoney(
            (line?.unit_price_minor ?? item.unitPrice) * item.quantity,
            item.currency
          )}</div>
        </div>`;
    })
    .join('');

  qsa('[data-qty]', container).forEach((button) => {
    button.addEventListener('click', () => {
      const [productId, variantRaw] = button.dataset.key.split(':');
      const variantId = variantRaw === 'base' ? null : variantRaw;
      const item = cart.get().items.find((entry) => lineKey(entry.productId, entry.variantId) === button.dataset.key);
      if (!item) return;
      cart.setQuantity(productId, variantId, item.quantity + Number(button.dataset.qty));
      queueValidation();
    });
  });

  qsa('input[data-key]', container).forEach((input) => {
    input.addEventListener('change', () => {
      const [productId, variantRaw] = input.dataset.key.split(':');
      cart.setQuantity(productId, variantRaw === 'base' ? null : variantRaw, Number(input.value));
      queueValidation();
    });
  });

  qsa('[data-remove]', container).forEach((button) => {
    button.addEventListener('click', () => {
      const [productId, variantRaw] = button.dataset.remove.split(':');
      cart.remove(productId, variantRaw === 'base' ? null : variantRaw);
      validation = null;
      render();
      queueValidation();
    });
  });
}

function renderSummary() {
  const { subtotal, currency } = cart.get();
  const shipping = validation?.shipping_minor ?? null;
  const total = validation?.total_minor ?? subtotal;

  qs('#summary-rows').innerHTML = `
    <div class="summary__row"><span>Subtotal</span><span>${formatMoney(subtotal, currency)}</span></div>
    <div class="summary__row">
      <span>Delivery</span>
      <span>${shipping === null ? 'Calculated at checkout' : shipping === 0 ? 'Included' : formatMoney(shipping, currency)}</span>
    </div>
  `;
  qs('#summary-total').textContent = formatMoney(total, currency);

  const hasBlockingIssue = Boolean(validation?.issues?.length);
  const link = qs('#checkout-link');
  if (hasBlockingIssue) {
    link.setAttribute('aria-disabled', 'true');
    link.href = '/cart';
    qs('#summary-note').textContent = 'Please resolve the availability notes above before checkout.';
  } else {
    link.removeAttribute('aria-disabled');
    link.href = '/checkout';
    qs('#summary-note').textContent =
      shipping === null
        ? 'Delivery is calculated at checkout.'
        : shipping === 0
          ? 'Delivery included.'
          : 'Delivery calculated from your saved store settings.';
  }
}

function renderIssues() {
  const existing = qs('#cart-issues');
  existing?.remove();
  if (!validation?.issues?.length) return;

  const box = document.createElement('div');
  box.id = 'cart-issues';
  box.className = 'notice notice--warn';
  box.style.marginBottom = '1.5rem';
  box.innerHTML = validation.issues.map((issue) => `<p>${escapeHtml(issue.message)}</p>`).join('');
  qs('#cart-items').before(box);
}

function render() {
  renderItems();
  if (cart.get().items.length) {
    renderSummary();
    renderIssues();
  }
}

async function validateCart() {
  if (validating) return;
  const items = payloadFromCart();
  if (!items.length) {
    validation = null;
    render();
    return;
  }

  validating = true;
  try {
    const result = await apiFetch('/api/cart/validate', { method: 'POST', body: { items } });
    validation = result;

    if (result.items?.length) {
      cart.reconcile(
        result.items.map((line) => ({
          productId: line.product_id,
          variantId: line.variant_id,
          sku: line.sku,
          slug: line.slug,
          name: line.name,
          variantName: line.variant_name,
          image: line.image,
          unitPrice: line.unit_price_minor,
          currency: result.currency,
          quantity: line.quantity
        }))
      );
    }

    if (result.removed_count > 0) {
      toast('Some pieces are no longer available and were removed from your bag.', 'error');
    }
  } catch (error) {
    console.warn('[cart] validation failed:', error);
    validation = null;
  } finally {
    validating = false;
    render();
  }
}

const queueValidation = debounce(validateCart, 450);

async function init() {
  await initLayout();
  setMeta({ title: 'Your Bag | Hasswell London', noindex: true, path: '/cart' });

  cart.subscribe(() => render());
  render();
  validateCart();

  // Trust strip below the bag
  const strip = document.createElement('div');
  strip.className = 'trust-row';
  strip.style.marginTop = '2rem';
  strip.innerHTML = `
    <span class="trust-item">${icons.shield} Secure checkout</span>
    <span class="trust-item">${icons.truck} Delivery options at checkout</span>
    <span class="trust-item">${icons.returns} 30-day returns</span>`;
  qs('#cart-items')?.after(strip);
}

init().catch((error) => console.error('[cart]', error));
