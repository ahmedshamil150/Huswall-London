import { cart } from './cart.js';
import { getSession } from './auth.js';
import { getSettings } from './settings.js';
import { escapeHtml, icons, initReveal } from './dom.js';
import { initAnalytics } from './seo.js';
import { isSupabaseConfigured } from './config.js';

const NAV = [
  { label: 'Shop', href: '/shop' },
  { label: 'New In', href: '/shop?sort=newest' },
  { label: 'Best Sellers', href: '/shop?best=1' },
  { label: 'Our Story', href: '/about' },
  { label: 'Contact', href: '/contact' }
];

function isCurrent(href) {
  const url = new URL(href, window.location.origin);
  if (url.pathname !== window.location.pathname) return false;
  const currentSort = new URLSearchParams(window.location.search).get('sort');
  const linkSort = url.searchParams.get('sort');
  if (linkSort) return currentSort === linkSort;
  if (url.searchParams.get('best')) return new URLSearchParams(window.location.search).get('best') === '1';
  if (window.location.pathname === '/shop' && (currentSort || new URLSearchParams(window.location.search).get('best'))) {
    return false;
  }
  return true;
}

function headerHtml(settings, signedIn) {
  const navLinks = NAV.map(
    (item) =>
      `<a href="${item.href}" ${isCurrent(item.href) ? 'aria-current="page"' : ''}>${item.label}</a>`
  ).join('');

  return `
    ${settings['store.announcement'] ? `<div class="announcement">${escapeHtml(settings['store.announcement'])}</div>` : ''}
    <header class="site-header">
      <div class="container site-header__inner">
        <a class="wordmark" href="/" aria-label="Hasswell London home">
          <span>Hasswell</span>
          <span class="wordmark__sub">London</span>
        </a>
        <nav class="site-nav" aria-label="Primary">${navLinks}</nav>
        <div class="header-actions">
          <button class="icon-btn" type="button" id="search-toggle" aria-label="Search products" aria-expanded="false" aria-controls="search-panel">
            ${icons.search}
          </button>
          <a class="icon-btn icon-btn--account" href="${signedIn ? '/account' : '/login'}" aria-label="${signedIn ? 'My account' : 'Sign in'}">
            ${icons.user}
          </a>
          <a class="icon-btn" href="/cart" aria-label="Shopping bag">
            ${icons.bag}
            <span class="cart-count" data-cart-count hidden>0</span>
          </a>
          <button class="icon-btn nav-toggle" type="button" id="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-drawer">
            ${icons.menu}
          </button>
        </div>
      </div>
      <div class="search-panel" id="search-panel">
        <div class="container">
          <form action="/shop" method="get" role="search">
            <label class="visually-hidden" for="search-input">Search products</label>
            <input id="search-input" name="q" type="search" placeholder="Search for candles, linen, tea…" autocomplete="off">
            <button class="btn btn--sm" type="submit">Search</button>
          </form>
        </div>
      </div>
    </header>

    <div class="drawer-backdrop" id="drawer-backdrop" hidden></div>
    <aside class="drawer" id="mobile-drawer" aria-label="Menu" aria-hidden="true">
      <div class="drawer__head">
        <span class="wordmark"><span>Hasswell</span><span class="wordmark__sub">London</span></span>
        <button class="icon-btn" type="button" id="drawer-close" aria-label="Close menu">${icons.close}</button>
      </div>
      <nav class="drawer__nav" aria-label="Mobile">
        ${NAV.map((item) => `<a href="${item.href}">${item.label}</a>`).join('')}
        <a href="${signedIn ? '/account' : '/login'}">${signedIn ? 'My Account' : 'Sign In'}</a>
      </nav>
      <div class="drawer__foot">
        <p class="small muted">${escapeHtml(settings['store.address'] || 'London, United Kingdom')}</p>
        <a class="small" href="mailto:${escapeHtml(settings['store.email'])}" style="display:inline-block;margin-top:.5rem">
          ${escapeHtml(settings['store.email'])}
        </a>
      </div>
    </aside>
  `;
}

function footerHtml(settings) {
  const year = new Date().getFullYear();
  return `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <span class="wordmark"><span>Hasswell</span><span class="wordmark__sub">London</span></span>
            <p>${escapeHtml(settings['store.tagline'] || 'Considered objects for the modern British home.')}</p>
            <div class="footer-contact">
              <a href="mailto:${escapeHtml(settings['store.email'])}">${escapeHtml(settings['store.email'])}</a>
              ${settings['store.phone'] ? `<br><a href="tel:${escapeHtml(settings['store.phone'])}">${escapeHtml(settings['store.phone'])}</a>` : ''}
            </div>
          </div>
          <div class="footer-col">
            <h3>Shop</h3>
            <ul>
              <li><a href="/shop">All Products</a></li>
              <li><a href="/shop?sort=newest">New Arrivals</a></li>
              <li><a href="/shop?best=1">Best Sellers</a></li>
              <li><a href="/shop?category=candles">Candles</a></li>
              <li><a href="/shop?category=home-fragrance">Home Fragrance</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h3>Help</h3>
            <ul>
              <li><a href="/delivery-returns">Delivery &amp; Returns</a></li>
              <li><a href="/faqs">FAQs</a></li>
              <li><a href="/contact">Contact Us</a></li>
              <li><a href="/account">Track an Order</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h3>Company</h3>
            <ul>
              <li><a href="/about">Our Story</a></li>
              <li><a href="/privacy">Privacy Policy</a></li>
              <li><a href="/cookies">Cookie Policy</a></li>
              <li><a href="/terms">Terms &amp; Conditions</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <p>© ${year} ${escapeHtml(settings['store.name'])}. All rights reserved.${
            settings['legal.company_number']
              ? ` Registered in England &amp; Wales, company no. ${escapeHtml(settings['legal.company_number'])}.`
              : ''
          }</p>
          <div class="footer-payments">
            <span>Secure checkout</span>
            <span>${escapeHtml(settings['store.currency'] || 'GBP')}</span>
          </div>
        </div>
      </div>
    </footer>
  `;
}

function wireLayout(signedIn) {
  const header = document.getElementById('site-header');
  const footer = document.getElementById('site-footer');
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const navToggle = document.getElementById('nav-toggle');
  const drawerClose = document.getElementById('drawer-close');
  const searchToggle = document.getElementById('search-toggle');
  const searchPanel = document.getElementById('search-panel');
  const searchInput = document.getElementById('search-input');

  let previousFocus = null;

  function openDrawer() {
    previousFocus = document.activeElement;
    drawer.classList.add('is-open');
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add('is-open'));
    drawer.setAttribute('aria-hidden', 'false');
    navToggle?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('no-scroll');
    drawerClose?.focus();
  }

  function closeDrawer() {
    drawer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    navToggle?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('no-scroll');
    setTimeout(() => {
      backdrop.hidden = true;
    }, 300);
    previousFocus?.focus?.();
  }

  navToggle?.addEventListener('click', openDrawer);
  drawerClose?.addEventListener('click', closeDrawer);
  backdrop?.addEventListener('click', closeDrawer);
  drawer?.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeDrawer();
  });

  searchToggle?.addEventListener('click', () => {
    const open = searchPanel.classList.toggle('is-open');
    searchToggle.setAttribute('aria-expanded', String(open));
    if (open) searchInput?.focus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (drawer?.classList.contains('is-open')) closeDrawer();
    if (searchPanel?.classList.contains('is-open')) {
      searchPanel.classList.remove('is-open');
      searchToggle?.setAttribute('aria-expanded', 'false');
    }
  });

  // Account link reflects live auth state (session may resolve after render).
  getSession().then((session) => {
    const link = header?.querySelector('.icon-btn--account');
    if (!link) return;
    const authed = Boolean(session);
    link.href = authed ? '/account' : '/login';
    link.setAttribute('aria-label', authed ? 'My account' : 'Sign in');
  });

  cart.subscribe(({ count }) => {
    document.querySelectorAll('[data-cart-count]').forEach((node) => {
      node.textContent = count > 99 ? '99+' : String(count);
      node.hidden = count === 0;
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08 }
  );
  document.querySelectorAll('.reveal').forEach((node) => observer.observe(node));

  initReveal();
}

/**
 * Renders the shared header/footer into each page and wires navigation.
 * Pages include <div id="site-header"></div> and <div id="site-footer"></div>.
 */
export async function initLayout({ renderHeader = true, renderFooter = true } = {}) {
  const header = document.getElementById('site-header');
  const footer = document.getElementById('site-footer');
  const settings = await getSettings();
  const session = await getSession();
  const signedIn = Boolean(session);

  if (header && renderHeader) header.innerHTML = headerHtml(settings, signedIn);
  if (footer && renderFooter) footer.innerHTML = footerHtml(settings);

  wireLayout(signedIn);
  initAnalytics();

  if (!isSupabaseConfigured) {
    const banner = document.createElement('div');
    banner.className = 'notice notice--warn';
    banner.style.margin = '1rem auto';
    banner.style.maxWidth = '1280px';
    banner.innerHTML =
      'Store configuration is incomplete. Add <code>VITE_SUPABASE_URL</code> and ' +
      '<code>VITE_SUPABASE_ANON_KEY</code> to your environment — see <code>docs/setup.md</code>.';
    header?.after(banner);
  }

  return settings;
}

/** Shared newsletter form handler. */
export function wireNewsletterForms() {
  document.querySelectorAll('[data-newsletter-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const button = form.querySelector('button[type="submit"]');
      const email = input?.value.trim();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        input?.focus();
        return;
      }
      button.disabled = true;
      try {
        const { apiFetch } = await import('./api.js');
        await apiFetch('/api/newsletter', { method: 'POST', body: { email, source: 'storefront' } });
        form.reset();
        const note = form.querySelector('.form-note');
        if (note) note.textContent = 'Thank you — you are on the list.';
      } catch (error) {
        const note = form.querySelector('.form-note');
        if (note) note.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  });
}
