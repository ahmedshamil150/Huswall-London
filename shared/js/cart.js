import { CART_STORAGE_KEY } from './config.js';

/**
 * Client-side cart.
 *
 * Only identifiers, quantities and a display snapshot are kept here. The
 * server recalculates prices, validates stock and creates the authoritative
 * order total during checkout.
 *
 * item shape:
 * { productId, variantId|null, sku, slug, name, variantName, image,
 *   unitPrice, quantity, currency }
 */

const listeners = new Set();
let state = read();

function read() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return { items: [], updatedAt: null };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return { items: [], updatedAt: null };
    return {
      items: parsed.items
        .filter((item) => item && item.productId && Number(item.quantity) > 0)
        .map((item) => ({ ...item, quantity: Math.min(Math.max(Number(item.quantity), 1), 99) })),
      updatedAt: parsed.updatedAt ?? null
    };
  } catch {
    return { items: [], updatedAt: null };
  }
}

function persist(next) {
  state = { ...next, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Storage may be unavailable in private mode; the cart still works for this page. */
  }
  listeners.forEach((fn) => fn(snapshot()));
}

function emit() {
  listeners.forEach((fn) => fn(snapshot()));
}

export function lineKey(productId, variantId) {
  return `${productId}:${variantId || 'base'}`;
}

export function snapshot() {
  return {
    items: state.items.map((item) => ({ ...item })),
    count: state.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: state.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    currency: state.items[0]?.currency || 'GBP',
    updatedAt: state.updatedAt
  };
}

export const cart = {
  get: snapshot,
  subscribe(fn) {
    listeners.add(fn);
    fn(snapshot());
    return () => listeners.delete(fn);
  },
  add(item, quantity = 1) {
    const key = lineKey(item.productId, item.variantId);
    const items = [...state.items];
    const index = items.findIndex((existing) => lineKey(existing.productId, existing.variantId) === key);

    if (index >= 0) {
      items[index] = {
        ...items[index],
        ...item,
        quantity: Math.min(items[index].quantity + quantity, 99)
      };
    } else {
      items.push({ ...item, quantity: Math.min(Math.max(quantity, 1), 99) });
    }
    persist({ items });
  },
  setQuantity(productId, variantId, quantity) {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      cart.remove(productId, variantId);
      return;
    }
    const items = state.items.map((item) =>
      lineKey(item.productId, item.variantId) === lineKey(productId, variantId)
        ? { ...item, quantity: Math.min(Math.round(qty), 99) }
        : item
    );
    persist({ items });
  },
  remove(productId, variantId) {
    persist({
      items: state.items.filter(
        (item) => lineKey(item.productId, item.variantId) !== lineKey(productId, variantId)
      )
    });
  },
  replace(items) {
    persist({ items: Array.isArray(items) ? items : [] });
  },
  clear() {
    persist({ items: [] });
  },
  /** Re-apply server-validated prices/stock without changing quantities. */
  reconcile(validatedItems) {
    const merged = [];
    for (const item of state.items) {
      const match = validatedItems.find(
        (v) => v.productId === item.productId && (v.variantId || null) === (item.variantId || null)
      );
      if (match) merged.push({ ...item, ...match });
    }
    persist({ items: merged });
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
};

// Keep tabs in sync.
window.addEventListener('storage', (event) => {
  if (event.key !== CART_STORAGE_KEY) return;
  state = read();
  emit();
});
