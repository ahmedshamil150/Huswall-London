import { initLayout, wireNewsletterForms } from '/shared/js/layout.js';
import { getProducts, getCategories } from '/shared/js/catalog.js';
import { renderProductGrid } from '/shared/js/components/product-card.js';
import { getSettings } from '/shared/js/settings.js';
import { setMeta, organisationJsonLd } from '/shared/js/seo.js';
import { qs, escapeHtml } from '/shared/js/dom.js';

async function renderCategoryTiles() {
  const container = qs('#category-tiles');
  const categories = await getCategories();
  const chosen = ['candles', 'home-living', 'bath-body']
    .map((slug) => categories.find((category) => category.slug === slug))
    .filter(Boolean);

  if (!chosen.length) {
    container?.remove();
    return;
  }

  container.innerHTML = chosen
    .map(
      (category) => `
        <a class="tile reveal" href="/shop?category=${encodeURIComponent(category.slug)}">
          <img src="${escapeHtml(category.image_url || `/assets/products/category-${category.slug}.svg`)}"
               alt="${escapeHtml(category.name)}" width="800" height="1000" loading="lazy"
               onerror="this.src='/assets/products/placeholder.svg'">
          <div class="tile__body">
            <h3>${escapeHtml(category.name)}</h3>
            <p>${escapeHtml(category.description || '')}</p>
            <span class="link-underline">Shop ${escapeHtml(category.name)}</span>
          </div>
        </a>`
    )
    .join('');
}

async function init() {
  const settings = await initLayout();
  wireNewsletterForms();

  setMeta({
    title: 'Hasswell London — Considered objects for the modern British home',
    description:
      'Home fragrance, textiles and everyday objects chosen for the way they age. Designed in London, made in small batches by British workshops.',
    path: '/',
    jsonLd: organisationJsonLd(settings)
  });

  renderCategoryTiles().catch((error) => console.warn('[home] categories:', error.message));

  const [best, latest] = await Promise.allSettled([
    getProducts({ bestSeller: true, pageSize: 4, sort: 'popular' }),
    getProducts({ newArrival: true, pageSize: 4, sort: 'newest' })
  ]);

  const bestContainer = qs('#best-sellers');
  const newContainer = qs('#new-arrivals');

  if (best.status === 'fulfilled') {
    renderProductGrid(bestContainer, best.value.items);
  } else {
    bestContainer.innerHTML = '<p class="muted" style="grid-column:1/-1">The catalogue could not be loaded just now.</p>';
    console.error('[home] best sellers:', best.reason);
  }

  if (latest.status === 'fulfilled' && latest.value.items.length) {
    renderProductGrid(newContainer, latest.value.items);
  } else if (latest.status === 'fulfilled') {
    newContainer.closest('section')?.remove();
  } else {
    newContainer.innerHTML = '';
  }
}

init().catch((error) => {
  console.error('[home]', error);
});
