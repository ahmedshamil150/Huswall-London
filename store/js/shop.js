import { initLayout } from '/shared/js/layout.js';
import { getCategories, getCategoryCounts, getProducts } from '/shared/js/catalog.js';
import { renderProductGrid } from '/shared/js/components/product-card.js';
import { setMeta, breadcrumbJsonLd } from '/shared/js/seo.js';
import { qs, qsa, escapeHtml } from '/shared/js/dom.js';

const PAGE_SIZE = 12;
const SORT_LABELS = {
  featured: 'Featured',
  newest: 'Newest',
  popular: 'Popularity',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  name_asc: 'Name: A–Z'
};

const state = {
  category: null,
  q: '',
  sort: 'featured',
  page: 1,
  inStock: false,
  minPrice: null,
  maxPrice: null,
  best: false
};

let categories = [];
let counts = {};

function readParams() {
  const params = new URLSearchParams(window.location.search);
  state.category = params.get('category');
  state.q = params.get('q')?.trim() ?? '';
  state.sort = params.get('sort') || 'featured';
  state.page = Math.max(1, Number(params.get('page')) || 1);
  state.inStock = params.get('in_stock') === '1';
  state.best = params.get('best') === '1';
  const price = params.get('price');
  if (price && price.includes('-')) {
    const [min, max] = price.split('-');
    state.minPrice = min ? Number(min) : null;
    state.maxPrice = max ? Number(max) : null;
  } else {
    state.minPrice = null;
    state.maxPrice = null;
  }
  if (!SORT_LABELS[state.sort]) state.sort = 'featured';
}

function writeParams(replace = false) {
  const params = new URLSearchParams();
  if (state.category) params.set('category', state.category);
  if (state.q) params.set('q', state.q);
  if (state.sort !== 'featured') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  if (state.inStock) params.set('in_stock', '1');
  if (state.best) params.set('best', '1');
  if (state.minPrice !== null || state.maxPrice !== null) {
    params.set('price', `${state.minPrice ?? ''}-${state.maxPrice ?? ''}`);
  }
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
}

function renderCategories() {
  const list = qs('#category-list');
  const allCount = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const items = [
    `<li><a href="/shop" data-category="" ${!state.category ? 'aria-current="true"' : ''}>
       <span>All products</span><span class="count">${allCount || ''}</span></a></li>`,
    ...categories.map(
      (category) => `<li><a href="/shop?category=${encodeURIComponent(category.slug)}"
        data-category="${escapeHtml(category.slug)}"
        ${state.category === category.slug ? 'aria-current="true"' : ''}>
        <span>${escapeHtml(category.name)}</span>
        <span class="count">${counts[category.id] ?? ''}</span></a></li>`
    )
  ];
  list.innerHTML = items.join('');
  qsa('a[data-category]', list).forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      state.category = link.dataset.category || null;
      state.page = 1;
      update();
    });
  });
}

function renderActiveFilters() {
  const container = qs('#active-filters');
  const chips = [];
  if (state.category) {
    const category = categories.find((c) => c.slug === state.category);
    chips.push({ label: category?.name ?? state.category, clear: () => (state.category = null) });
  }
  if (state.q) chips.push({ label: `“${state.q}”`, clear: () => (state.q = '') });
  if (state.inStock) chips.push({ label: 'In stock only', clear: () => (state.inStock = false) });
  if (state.best) chips.push({ label: 'Best sellers', clear: () => (state.best = false) });
  if (state.minPrice !== null || state.maxPrice !== null) {
    chips.push({
      label: 'Price filter',
      clear: () => {
        state.minPrice = null;
        state.maxPrice = null;
      }
    });
  }

  container.innerHTML = chips
    .map(
      (chip, index) =>
        `<span class="chip">${escapeHtml(chip.label)}<button type="button" data-chip="${index}" aria-label="Remove filter">×</button></span>`
    )
    .join('');

  qsa('[data-chip]', container).forEach((button) => {
    button.addEventListener('click', () => {
      chips[Number(button.dataset.chip)].clear();
      state.page = 1;
      update();
    });
  });

  qs('#filter-in-stock').checked = state.inStock;
  qsa('#price-list button').forEach((button) => {
    const [min, max] = button.dataset.price.split('-');
    const active =
      String(state.minPrice ?? '') === min && String(state.maxPrice ?? '') === max;
    button.setAttribute('aria-current', active ? 'true' : 'false');
  });
}

function renderPagination(totalPages) {
  const nav = qs('#pagination');
  if (totalPages <= 1) {
    nav.innerHTML = '';
    return;
  }

  const pages = [];
  const add = (page) => pages.push(page);
  add(1);
  for (let p = state.page - 1; p <= state.page + 1; p += 1) if (p > 1 && p < totalPages) add(p);
  add(totalPages);
  const unique = [...new Set(pages)].sort((a, b) => a - b);

  let html = `<button type="button" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''} aria-label="Previous page">←</button>`;
  unique.forEach((page, index) => {
    if (index > 0 && page - unique[index - 1] > 1) html += '<span aria-hidden="true">…</span>';
    html += `<button type="button" data-page="${page}" ${page === state.page ? 'aria-current="page"' : ''}>${page}</button>`;
  });
  html += `<button type="button" data-page="${state.page + 1}" ${state.page === totalPages ? 'disabled' : ''} aria-label="Next page">→</button>`;
  nav.innerHTML = html;

  qsa('button[data-page]', nav).forEach((button) => {
    button.addEventListener('click', () => {
      const page = Number(button.dataset.page);
      if (!page || button.disabled) return;
      state.page = page;
      update();
      window.scrollTo({ top: qs('.shop-toolbar').offsetTop - 120, behavior: 'smooth' });
    });
  });
}

async function load() {
  const grid = qs('#product-grid');
  grid.setAttribute('aria-busy', 'true');
  qs('#result-count').textContent = 'Loading…';
  writeParams(true);

  const category = categories.find((c) => c.slug === state.category);
  if (state.category) {
    qs('#shop-title').textContent = category?.name ?? 'The Collection';
    qs('#shop-subtitle').textContent =
      category?.description ?? 'A short catalogue of objects for the home, made in small batches.';
  } else if (state.best) {
    qs('#shop-title').textContent = 'Best Sellers';
    qs('#shop-subtitle').textContent = 'The pieces our customers return to.';
  } else {
    qs('#shop-title').textContent = 'The Collection';
    qs('#shop-subtitle').textContent = 'A short catalogue of objects for the home, made in small batches.';
  }

  renderCategories();
  renderActiveFilters();

  try {
    const result = await getProducts({
      categorySlug: state.category,
      search: state.q,
      sort: state.sort,
      page: state.page,
      pageSize: PAGE_SIZE,
      inStockOnly: state.inStock,
      bestSeller: state.best
    });

    // Price filtering is applied client-side to keep the catalogue query simple;
    // it only affects presentation and never order totals.
    let items = result.items;
    if (state.minPrice !== null || state.maxPrice !== null) {
      items = items.filter((product) => {
        const price = product.price_minor;
        if (state.minPrice !== null && price < state.minPrice) return false;
        if (state.maxPrice !== null && price >= state.maxPrice) return false;
        return true;
      });
    }

    renderProductGrid(grid, items);
    qs('#result-count').textContent = `${items.length} ${items.length === 1 ? 'piece' : 'pieces'}${
      result.total > items.length && state.minPrice === null && state.maxPrice === null
        ? ` of ${result.total}`
        : ''
    }`;
    renderPagination(result.totalPages);

    setMeta({
      title: `${qs('#shop-title').textContent} | Hasswell London`,
      description: qs('#shop-subtitle').textContent,
      path: `${window.location.pathname}${window.location.search}`,
      jsonLd: breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: qs('#shop-title').textContent, path: '/shop' }
      ])
    });
  } catch (error) {
    console.error('[shop]', error);
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <h2>We could not load the collection</h2>
      <p>${escapeHtml(error.message)}</p>
      <button class="btn btn--outline" type="button" id="retry">Try again</button>
    </div>`;
    qs('#retry')?.addEventListener('click', load);
    qs('#result-count').textContent = '';
    qs('#pagination').innerHTML = '';
  } finally {
    grid.setAttribute('aria-busy', 'false');
  }
}

function update() {
  load();
}

async function init() {
  await initLayout();
  setMeta({
    title: 'Shop All | Hasswell London',
    description:
      'Browse the Hasswell London collection: hand-poured candles, home fragrance, bath and body, textiles and kitchen objects.',
    path: '/shop'
  });

  readParams();
  qs('#sort').value = state.sort;

  try {
    [categories, counts] = await Promise.all([getCategories(), getCategoryCounts()]);
  } catch (error) {
    console.warn('[shop] categories:', error.message);
  }

  qs('#sort').addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.page = 1;
    update();
  });

  qs('#filter-in-stock').addEventListener('change', (event) => {
    state.inStock = event.target.checked;
    state.page = 1;
    update();
  });

  qsa('#price-list button').forEach((button) => {
    button.addEventListener('click', () => {
      const [min, max] = button.dataset.price.split('-');
      const already =
        String(state.minPrice ?? '') === min && String(state.maxPrice ?? '') === max;
      state.minPrice = already ? null : min ? Number(min) : null;
      state.maxPrice = already ? null : max ? Number(max) : null;
      state.page = 1;
      update();
    });
  });

  qs('#clear-filters').addEventListener('click', () => {
    state.category = null;
    state.q = '';
    state.inStock = false;
    state.best = false;
    state.minPrice = null;
    state.maxPrice = null;
    state.page = 1;
    update();
  });

  const filters = qs('#filters');
  qs('#filters-open')?.addEventListener('click', () => {
    filters.classList.add('is-open');
    document.body.classList.add('no-scroll');
    qs('#filters-close')?.focus();
  });
  qs('#filters-close')?.addEventListener('click', () => {
    filters.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
  });
  qs('#filters-close').style.display = 'none';
  if (window.matchMedia('(max-width: 900px)').matches) {
    qs('#filters-close').style.display = '';
  }

  // Deep-link search from the header: /shop?q=…
  window.addEventListener('popstate', () => {
    readParams();
    qs('#sort').value = state.sort;
    load();
  });

  load();
}

init().catch((error) => console.error('[shop] init', error));
