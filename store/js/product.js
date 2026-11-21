import { initLayout } from '/shared/js/layout.js';
import { getProductBySlug, getRelatedProducts, getProductStock } from '/shared/js/catalog.js';
import { renderProductGrid } from '/shared/js/components/product-card.js';
import { cart } from '/shared/js/cart.js';
import { formatMoney, percentOff } from '/shared/js/money.js';
import { setMeta, productJsonLd, breadcrumbJsonLd, trackEvent } from '/shared/js/seo.js';
import { qs, escapeHtml, toast, icons } from '/shared/js/dom.js';

const STOCK_COPY = {
  in_stock: { label: 'In stock — ready to dispatch', dot: 'dot' },
  low_stock: { label: 'Low stock — a few remaining', dot: 'dot dot--low' },
  out_of_stock: { label: 'Out of stock', dot: 'dot dot--out' },
  preorder: { label: 'Available to pre-order', dot: 'dot' },
  unavailable: { label: 'Currently unavailable', dot: 'dot dot--out' }
};

const state = { product: null, selectedVariant: null, quantity: 1, stock: [], images: [] };

function slugFromLocation() {
  const pathMatch = window.location.pathname.match(/^\/product\/([^/]+)\/?$/);
  if (pathMatch) return decodeURIComponent(pathMatch[1]);
  return new URLSearchParams(window.location.search).get('slug');
}

function availableFor(variantId) {
  if (!state.stock.length) return null;
  const row = state.stock.find((entry) => (entry.variant_id || null) === (variantId || null));
  return row ? Number(row.available) : 0;
}

function currentUnitPrice() {
  if (state.selectedVariant) return state.selectedVariant.price_minor;
  return state.product.price_minor;
}

function currentCompareAt() {
  if (state.selectedVariant) return state.selectedVariant.compare_at_price_minor;
  return state.product.compare_at_price_minor;
}

function currentSku() {
  return state.selectedVariant?.sku ?? state.product.sku;
}

function currentAvailability() {
  return state.selectedVariant?.availability ?? state.product.availability;
}

function renderGallery() {
  const gallery = qs('#gallery');
  const images = state.images;
  gallery.innerHTML = `
    <div class="gallery__main">
      <img id="gallery-main" src="${escapeHtml(images[0].url)}" alt="${escapeHtml(images[0].alt || state.product.name)}"
           width="800" height="1000" fetchpriority="high">
    </div>
    ${
      images.length > 1
        ? `<div class="gallery__thumbs" role="list">
            ${images
              .map(
                (image, index) => `
              <button class="gallery__thumb" type="button" data-index="${index}"
                      aria-current="${index === 0}" aria-label="View image ${index + 1}">
                <img src="${escapeHtml(image.url)}" alt="" width="150" height="150" loading="lazy">
              </button>`
              )
              .join('')}
          </div>`
        : ''
    }
  `;

  gallery.querySelectorAll('.gallery__thumb').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.index);
      const main = qs('#gallery-main');
      main.src = images[index].url;
      main.alt = images[index].alt || state.product.name;
      gallery.querySelectorAll('.gallery__thumb').forEach((thumb) => thumb.setAttribute('aria-current', 'false'));
      button.setAttribute('aria-current', 'true');
    });
  });
}

function renderInfo() {
  const product = state.product;
  const info = qs('#pdp-info');
  const availability = currentAvailability();
  const stockCopy = STOCK_COPY[availability] ?? STOCK_COPY.out_of_stock;
  const available = availableFor(state.selectedVariant?.id ?? null);
  const onSale = Boolean(currentCompareAt() && currentCompareAt() > currentUnitPrice());
  const price = currentUnitPrice();

  info.innerHTML = `
    <span class="eyebrow">${escapeHtml(product.category?.name ?? product.brand)}</span>
    <h1>${escapeHtml(product.name)}</h1>

    <div class="pdp__price">
      <span class="${onSale ? 'price-sale' : ''}">${formatMoney(price, product.currency)}</span>
      ${onSale ? `<span class="price-was">${formatMoney(currentCompareAt(), product.currency)}</span>` : ''}
      ${onSale ? `<span class="status-pill status-pill--pending">${percentOff(price, currentCompareAt())}% off</span>` : ''}
    </div>

    <p class="pdp__desc">${escapeHtml(product.short_description || '')}</p>

    ${
      product.hasVariants
        ? `<div class="option-group">
            <span class="option-group__label" id="variant-label">Size</span>
            <div class="option-row" role="group" aria-labelledby="variant-label">
              ${product.variants
                .map((variant) => {
                  const stock = availableFor(variant.id);
                  const soldOut = stock === 0 || variant.availability === 'out_of_stock';
                  return `<button class="option-pill" type="button" data-variant="${variant.id}"
                    aria-pressed="${variant.id === state.selectedVariant?.id ? 'true' : 'false'}"
                    ${soldOut ? 'disabled' : ''}>
                    ${escapeHtml(variant.name)} — ${formatMoney(variant.price_minor, product.currency)}
                  </button>`;
                })
                .join('')}
            </div>
          </div>`
        : ''
    }

    <div class="stock-line">
      <span class="${stockCopy.dot}"></span>
      <span id="stock-text">${stockCopy.label}${available !== null && available > 0 && available <= 5 ? ` (${available} left)` : ''}</span>
    </div>

    <div class="add-row">
      <div class="qty">
        <button type="button" data-qty="-1" aria-label="Decrease quantity">−</button>
        <input type="number" id="quantity" value="${state.quantity}" min="1" max="${Math.max(1, Math.min(available ?? 10, 20))}" aria-label="Quantity">
        <button type="button" data-qty="1" aria-label="Increase quantity">+</button>
      </div>
      <button class="btn" type="button" id="add-to-cart" ${availability === 'out_of_stock' || availability === 'unavailable' ? 'disabled' : ''}>
        ${availability === 'out_of_stock' || availability === 'unavailable' ? 'Out of stock' : 'Add to bag'}
      </button>
    </div>

    <div class="trust-row">
      <span class="trust-item">${icons.truck} UK delivery</span>
      <span class="trust-item">${icons.returns} 30-day returns</span>
      <span class="trust-item">${icons.shield} Secure checkout</span>
    </div>

    <div class="pdp__accordions">
      <details class="accordion" open>
        <summary>Details</summary>
        <div class="accordion__body">${formatDescription(product.description)}</div>
      </details>
      <details class="accordion">
        <summary>Materials &amp; care</summary>
        <div class="accordion__body">
          <p>${escapeHtml(product.brand)} pieces are made in small batches. Follow the care card enclosed with your order; if you need a replacement copy, contact us and we will send one.</p>
          <p class="small muted">SKU: ${escapeHtml(currentSku())}</p>
        </div>
      </details>
      <details class="accordion">
        <summary>Delivery &amp; returns</summary>
        <div class="accordion__body">
          <p>Delivery options and charges are confirmed at checkout. Returns are accepted within the window set out in our <a href="/delivery-returns" style="text-decoration:underline">Delivery &amp; Returns</a> policy.</p>
        </div>
      </details>
    </div>
  `;

  qs('#add-to-cart').addEventListener('click', addToCart);
  qs('#quantity').addEventListener('change', (event) => {
    const max = Number(event.target.max) || 10;
    state.quantity = Math.min(Math.max(Number(event.target.value) || 1, 1), max);
    event.target.value = state.quantity;
  });
  info.querySelectorAll('[data-qty]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = qs('#quantity');
      const max = Number(input.max) || 10;
      state.quantity = Math.min(Math.max(state.quantity + Number(button.dataset.qty), 1), max);
      input.value = state.quantity;
    });
  });
  info.querySelectorAll('[data-variant]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedVariant = product.variants.find((variant) => variant.id === button.dataset.variant);
      state.quantity = 1;
      renderInfo();
    });
  });
}

function formatDescription(description) {
  if (!description) return '';
  return description
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

function addToCart() {
  const product = state.product;
  const available = availableFor(state.selectedVariant?.id ?? null);
  const quantity = state.quantity;

  if (available !== null && available < quantity) {
    toast(`Only ${available} available at the moment.`, 'error');
    return;
  }

  cart.add(
    {
      productId: product.id,
      variantId: state.selectedVariant?.id ?? null,
      sku: currentSku(),
      slug: product.slug,
      name: product.name,
      variantName: state.selectedVariant?.name ?? null,
      image: state.images[0].url,
      unitPrice: currentUnitPrice(),
      currency: product.currency
    },
    quantity
  );

  trackEvent('add_to_cart', {
    currency: product.currency,
    value: (currentUnitPrice() * quantity) / 100,
    items: [{ item_id: currentSku(), item_name: product.name, quantity }]
  });

  toast(`${product.name} added to your bag.`, 'success');
}

function renderBreadcrumb(product) {
  const crumb = qs('#breadcrumb');
  crumb.innerHTML = `
    <span><a href="/">Home</a></span>
    <span><a href="/shop">Shop</a></span>
    ${
      product.category
        ? `<span><a href="/shop?category=${encodeURIComponent(product.category.slug)}">${escapeHtml(
            product.category.name
          )}</a></span>`
        : ''
    }
    <span aria-current="page">${escapeHtml(product.name)}</span>
  `;
}

async function init() {
  await initLayout();
  const slug = slugFromLocation();
  if (!slug) {
    renderNotFound('No product was specified.');
    return;
  }

  let product;
  try {
    product = await getProductBySlug(slug);
  } catch (error) {
    renderNotFound(error.message);
    return;
  }

  if (!product) {
    renderNotFound('This product is no longer available.');
    setMeta({ title: 'Product not found | Hasswell London', noindex: true, path: window.location.pathname });
    return;
  }

  state.product = product;
  state.images = product.images;
  state.stock = (await getProductStock(product.id)) ?? [];

  if (product.hasVariants) {
    const firstAvailable =
      product.variants.find((variant) => {
        const available = availableFor(variant.id);
        return variant.availability !== 'out_of_stock' && (available === null || available > 0);
      }) ?? product.variants[0];
    state.selectedVariant = firstAvailable;
  }

  // Prefer a variant's price for the canonical offer.
  if (product.hasVariants) {
    product.price_minor = Math.min(...product.variants.map((v) => v.price_minor));
  }

  renderGallery();
  renderInfo();
  renderBreadcrumb(product);

  const description =
    product.meta_description || product.short_description || product.description?.slice(0, 155) || '';
  setMeta({
    title: product.meta_title || `${product.name} | Hasswell London`,
    description,
    path: `/product/${product.slug}`,
    image: product.images[0].url,
    type: 'product',
    jsonLd: productJsonLd(product)
  });

  const crumbs = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Shop', path: '/shop' },
    ...(product.category
      ? [{ name: product.category.name, path: `/shop?category=${product.category.slug}` }]
      : []),
    { name: product.name, path: `/product/${product.slug}` }
  ]);
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(crumbs);
  document.head.append(script);

  trackEvent('view_item', {
    currency: product.currency,
    value: product.price_minor / 100,
    items: [{ item_id: product.sku, item_name: product.name, price: product.price_minor / 100 }]
  });

  try {
    const related = await getRelatedProducts(product, 4);
    if (related.length) {
      const section = qs('#related-section');
      section.hidden = false;
      renderProductGrid(qs('#related'), related);
    }
  } catch (error) {
    console.warn('[product] related:', error.message);
  }
}

function renderNotFound(message) {
  qs('#pdp').innerHTML = `
    <div class="empty-state" style="grid-column:1/-1;padding-block:5rem">
      <span class="eyebrow">Not found</span>
      <h2 style="margin-top:1rem">We could not find that piece.</h2>
      <p>${escapeHtml(message)}</p>
      <a class="btn btn--outline" href="/shop">Return to the collection</a>
    </div>`;
}

init().catch((error) => {
  console.error('[product]', error);
  renderNotFound('Something went wrong loading this product.');
});
