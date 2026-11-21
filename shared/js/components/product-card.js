import { formatMoney, percentOff } from '../money.js';
import { escapeHtml, toast } from '../dom.js';
import { cart } from '../cart.js';

const STOCK_LABELS = {
  in_stock: 'In stock',
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
  preorder: 'Pre-order',
  unavailable: 'Unavailable'
};

function badgeFor(product) {
  if (!product.inStock) return { text: 'Sold out', className: 'badge--soldout' };
  if (product.onSale) {
    return { text: `${percentOff(product.price_minor, product.compare_at_price_minor)}% off`, className: 'badge--sale' };
  }
  if (product.is_new_arrival) return { text: 'New', className: '' };
  if (product.lowStock) return { text: 'Low stock', className: 'badge--low' };
  return null;
}

/**
 * Creates a product card element. Prices shown here are for display only; the
 * server recalculates totals at checkout.
 */
export function createProductCard(product, { quickAdd = true, eager = false } = {}) {
  const badge = badgeFor(product);
  const href = `/product/${encodeURIComponent(product.slug)}`;
  const stockClass = product.lowStock ? 'is-low' : !product.inStock ? 'is-out' : '';
  const priceLabel = product.hasVariants ? 'From ' : '';

  const article = document.createElement('article');
  article.className = 'product-card';
  article.dataset.productId = product.id;

  article.innerHTML = `
    <div class="product-card__media-wrap" style="position:relative">
      <a class="product-card__media" href="${href}" aria-label="${escapeHtml(product.name)}">
        <img src="${escapeHtml(product.primaryImage)}" alt="${escapeHtml(product.images[0]?.alt || product.name)}"
             loading="${eager ? 'eager' : 'lazy'}" decoding="async" width="640" height="800">
      </a>
      ${badge ? `<span class="badge ${badge.className}">${badge.text}</span>` : ''}
      ${
        quickAdd
          ? product.hasVariants
            ? `<a class="quick-add" href="${href}" style="text-align:center;display:block">Choose options</a>`
            : `<button class="quick-add" type="button" data-action="quick-add" ${
                product.inStock ? '' : 'disabled'
              }>${product.inStock ? 'Add to bag' : 'Sold out'}</button>`
          : ''
      }
    </div>
    <div class="product-card__body">
      <span class="product-card__cat">${escapeHtml(product.category?.name ?? 'Hasswell London')}</span>
      <a class="product-card__title" href="${href}">${escapeHtml(product.name)}</a>
      <div class="product-card__price">
        <span class="price-now ${product.onSale ? 'price-sale' : ''}">${priceLabel}${formatMoney(
          product.price_minor,
          product.currency
        )}</span>
        ${
          product.onSale
            ? `<span class="price-was">${formatMoney(product.compare_at_price_minor, product.currency)}</span>`
            : ''
        }
      </div>
      <span class="product-card__stock ${stockClass}">${STOCK_LABELS[product.availability] ?? ''}</span>
    </div>
  `;

  const button = article.querySelector('[data-action="quick-add"]');
  button?.addEventListener('click', () => {
    cart.add({
      productId: product.id,
      variantId: null,
      sku: product.sku,
      slug: product.slug,
      name: product.name,
      variantName: null,
      image: product.primaryImage,
      unitPrice: product.price_minor,
      currency: product.currency
    });
    toast(`${product.name} added to your bag.`, 'success');
  });

  return article;
}

export function renderProductGrid(container, products, options = {}) {
  container.innerHTML = '';
  if (!products.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <h2>Nothing here yet</h2>
        <p>Try a different category or clear your search to see the full collection.</p>
        <a class="btn btn--outline" href="/shop">View all products</a>
      </div>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  products.forEach((product, index) => {
    fragment.append(createProductCard(product, { ...options, eager: index < 4 }));
  });
  container.append(fragment);
}
