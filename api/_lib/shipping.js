import { serviceClient } from './supabase.js';

/**
 * Shipping is derived from server-side store settings. The client never sends
 * a shipping amount — only the server decides what delivery costs.
 */

const SHIPPING_KEYS = [
  'shipping.flat_rate_minor',
  'shipping.free_threshold_minor',
  'shipping.estimate',
  'shipping.regions',
  'shipping.returns_window_days',
  'store.currency'
];

const DEFAULTS = {
  'shipping.flat_rate_minor': 0,
  'shipping.free_threshold_minor': 0,
  'shipping.estimate': '',
  'shipping.regions': ['GB'],
  'shipping.returns_window_days': 30,
  'store.currency': 'GBP'
};

function toMinor(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.round(number);
}

export async function loadShippingSettings() {
  const { data, error } = await serviceClient()
    .from('store_settings')
    .select('key, value')
    .in('key', SHIPPING_KEYS);

  if (error) throw error;

  const settings = { ...DEFAULTS };
  for (const row of data ?? []) {
    if (row && row.key) settings[row.key] = row.value;
  }
  return settings;
}

export function shippingRegions(settings) {
  const raw = settings?.['shipping.regions'];
  const list = Array.isArray(raw) ? raw : [];
  const clean = list
    .map((code) => String(code).trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
  return clean.length ? [...new Set(clean)] : ['GB'];
}

export function calculateShipping(subtotalMinor, settings) {
  const flat = toMinor(settings?.['shipping.flat_rate_minor'], 0);
  const threshold = toMinor(settings?.['shipping.free_threshold_minor'], 0);

  if (flat <= 0) return 0;
  if (threshold > 0 && subtotalMinor >= threshold) return 0;
  return flat;
}

export function shippingNote(settings) {
  const estimate = settings?.['shipping.estimate'];
  return typeof estimate === 'string' ? estimate.trim() : '';
}

export function storeCurrency(settings) {
  const currency = String(settings?.['store.currency'] || 'GBP').toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : 'GBP';
}
