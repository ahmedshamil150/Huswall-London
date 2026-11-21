import { getSession, getProfile, signIn, signOut } from '/shared/js/auth.js';
import { isSupabaseConfigured } from '/shared/js/config.js';
import { escapeHtml, setBusy } from '/shared/js/dom.js';
import { renderDashboard } from './views/dashboard.js';
import { renderProducts, renderProductEditor } from './views/products.js';
import { renderOrders, renderOrderDetail } from './views/orders.js';
import { renderInventory } from './views/inventory.js';
import { renderSettings } from './views/settings.js';
import { renderSupplier } from './views/supplier.js';
import { renderMessages } from './views/messages.js';

const shell = document.getElementById('admin-shell');
const root = document.getElementById('admin-root');

const state = {
  profile: null,
  route: { name: 'dashboard', id: null },
  renderToken: 0
};

const icons = {
  dashboard:
    '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
  products:
    '<svg viewBox="0 0 24 24"><path d="M4 7 12 3l8 4v10l-8 4-8-4Z"/><path d="m4 7 8 4 8-4M12 21V11"/></svg>',
  orders:
    '<svg viewBox="0 0 24 24"><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>',
  inventory:
    '<svg viewBox="0 0 24 24"><path d="M3 8h18v12H3z"/><path d="M3 8 6 4h12l3 4M8 12h8"/></svg>',
  supplier:
    '<svg viewBox="0 0 24 24"><path d="M3 9h18v11H3z"/><path d="M3 9l3-5h12l3 5M8 20V9M16 20V9"/></svg>',
  messages:
    '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
  menu:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7h18M3 12h18M3 17h18"/></svg>'
};

const NAV = [
  { name: 'dashboard', label: 'Dashboard', href: '#/dashboard' },
  { name: 'products', label: 'Products', href: '#/products' },
  { name: 'orders', label: 'Orders', href: '#/orders' },
  { name: 'inventory', label: 'Inventory', href: '#/inventory' },
  { name: 'supplier', label: 'Supplier', href: '#/supplier' },
  { name: 'messages', label: 'Messages', href: '#/messages' },
  { name: 'settings', label: 'Settings', href: '#/settings' }
];

const TITLES = {
  dashboard: 'Dashboard',
  products: 'Products',
  orders: 'Orders',
  inventory: 'Inventory',
  supplier: 'Supplier',
  messages: 'Messages',
  settings: 'Settings'
};

function showLogin(message = '') {
  state.profile = null;
  shell.hidden = true;
  root.hidden = false;

  root.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-mark">H</div>
        <h1>Hasswell London</h1>
        <p class="lede">Administrator sign-in. Customer accounts cannot open this dashboard.</p>
        ${message ? `<div class="notice notice--error" style="margin-top:1.2rem">${escapeHtml(message)}</div>` : ''}
        ${
          isSupabaseConfigured
            ? `<form id="login-form" novalidate>
                 <div class="field" style="margin-top:1.2rem">
                   <label for="login-email">Email</label>
                   <input id="login-email" name="email" type="email" autocomplete="username" required>
                 </div>
                 <div class="field" style="margin-top:.8rem">
                   <label for="login-password">Password</label>
                   <input id="login-password" name="password" type="password" autocomplete="current-password" required>
                 </div>
                 <div class="field__error" id="login-error" role="alert"></div>
                 <button class="btn" type="submit" id="login-submit">Sign in</button>
               </form>`
            : `<div class="notice notice--warn" style="margin-top:1.2rem">
                 Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the environment.
               </div>`
        }
        <div class="login-foot">
          <a href="/" class="link">View store</a>
          <span>Authorised staff only</span>
        </div>
      </div>
    </div>`;

  const form = root.querySelector('#login-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = root.querySelector('#login-submit');
    const errorBox = root.querySelector('#login-error');
    const email = root.querySelector('#login-email').value.trim();
    const password = root.querySelector('#login-password').value;
    errorBox.textContent = '';

    if (!email || !password) {
      errorBox.textContent = 'Enter your email address and password.';
      return;
    }

    setBusy(button, true, 'Signing in…');
    try {
      await signIn(email, password);
      const profile = await getProfile();
      if (!profile || profile.role !== 'admin' || !profile.is_active) {
        await signOut();
        throw new Error('This account does not have administrator access.');
      }
      state.profile = profile;
      renderShell();
      renderRoute();
    } catch (error) {
      errorBox.textContent =
        error?.message === 'Invalid login credentials'
          ? 'Those details were not recognised. Check your email and password.'
          : error?.message || 'Sign-in failed. Please try again.';
      setBusy(button, false);
    }
  });
}

function navHtml() {
  return NAV.map(
    (item) => `<a href="${item.href}" data-nav="${item.name}">
      <span class="nav-icon">${icons[item.name]}</span>${item.label}
    </a>`
  ).join('');
}

function renderShell() {
  shell.hidden = false;
  root.hidden = true;
  const profile = state.profile;

  shell.innerHTML = `
    <aside class="admin-sidebar" id="admin-sidebar" aria-label="Admin navigation">
      <a class="admin-brand" href="#/dashboard"><span>Hasswell</span><span>London</span></a>
      <nav class="admin-nav">${navHtml()}</nav>
      <div class="admin-nav-label">Operations</div>
      <div class="admin-sidebar-foot">
        <strong>${escapeHtml(profile?.full_name || profile?.email || 'Administrator')}</strong>
        <span>${escapeHtml(profile?.email || '')}</span>
        <div class="side-links">
          <a href="/" target="_blank" rel="noopener">Store</a>
          <a href="#" id="admin-logout">Sign out</a>
        </div>
      </div>
    </aside>
    <div class="admin-main">
      <header class="admin-topbar">
        <button class="admin-mobile-toggle" type="button" id="admin-menu" aria-label="Open navigation">
          ${icons.menu}
        </button>
        <h1 id="admin-title">Dashboard</h1>
        <div class="top-meta">
          <span class="badge badge--green">Admin</span>
        </div>
      </header>
      <main class="admin-content" id="view" tabindex="-1"></main>
    </div>
    <div class="sidebar-backdrop" id="sidebar-backdrop" hidden></div>`;

  const sidebar = shell.querySelector('#admin-sidebar');
  const backdrop = shell.querySelector('#sidebar-backdrop');
  const close = () => {
    sidebar.classList.remove('is-open');
    backdrop.hidden = true;
  };
  shell.querySelector('#admin-menu')?.addEventListener('click', () => {
    sidebar.classList.toggle('is-open');
    backdrop.hidden = !sidebar.classList.contains('is-open');
  });
  backdrop?.addEventListener('click', close);
  shell.querySelectorAll('.admin-nav a').forEach((link) => link.addEventListener('click', close));

  shell.querySelector('#admin-logout')?.addEventListener('click', async (event) => {
    event.preventDefault();
    await signOut();
    showLogin();
  });
}

function parseRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [name = 'dashboard', id = null] = raw.split('/');
  return { name, id };
}

function setActiveNav(name) {
  shell.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.nav === name);
  });
  const title = shell.querySelector('#admin-title');
  if (title) title.textContent = TITLES[name] || 'Admin';
}

async function renderRoute() {
  if (!state.profile) return;

  const token = ++state.renderToken;
  const route = parseRoute();
  state.route = route;
  setActiveNav(route.name);

  const view = shell.querySelector('#view');
  if (!view) return;
  view.innerHTML = '<div class="empty">Loading…</div>';

  const context = {
    profile: state.profile,
    route,
    navigate: (path) => {
      if (window.location.hash === `#${path}`) renderRoute();
      else window.location.hash = path;
    },
    refresh: renderRoute
  };

  try {
    if (route.name === 'dashboard') await renderDashboard(view, context);
    else if (route.name === 'products' && (route.id === 'new' || route.id)) {
      await renderProductEditor(view, context, route.id);
    } else if (route.name === 'products') await renderProducts(view, context);
    else if (route.name === 'orders' && route.id) await renderOrderDetail(view, context, route.id);
    else if (route.name === 'orders') await renderOrders(view, context);
    else if (route.name === 'inventory') await renderInventory(view, context);
    else if (route.name === 'supplier') await renderSupplier(view, context);
    else if (route.name === 'messages') await renderMessages(view, context);
    else if (route.name === 'settings') await renderSettings(view, context);
    else {
      view.innerHTML = `<div class="notice notice--warn">That page does not exist. <a class="link" href="#/dashboard">Return to the dashboard</a>.</div>`;
    }
  } catch (error) {
    if (token !== state.renderToken) return;
    console.error('[admin] render:', error);
    view.innerHTML = `<div class="notice notice--error"><strong>Could not load this page.</strong><p>${escapeHtml(
      error?.message || 'Please try again.'
    )}</p></div>`;
  }
}

window.addEventListener('hashchange', renderRoute);

window.addEventListener('admin:unauthorised', () => {
  showLogin('Your session has expired or this account no longer has admin access.');
});

async function boot() {
  if (!isSupabaseConfigured) {
    showLogin();
    return;
  }

  try {
    const session = await getSession();
    if (!session) {
      showLogin();
      return;
    }
    const profile = await getProfile();
    if (!profile || profile.role !== 'admin' || !profile.is_active) {
      await signOut();
      showLogin(
        new URLSearchParams(window.location.search).get('error') === 'forbidden'
          ? 'That account does not have administrator access.'
          : ''
      );
      return;
    }
    state.profile = profile;
    renderShell();
    if (!window.location.hash) window.location.hash = '#/dashboard';
    else renderRoute();
    if (!window.location.hash) renderRoute();
  } catch (error) {
    console.error('[admin] boot:', error);
    showLogin('The dashboard could not be initialised. Check your connection and try again.');
  }
}

boot();
