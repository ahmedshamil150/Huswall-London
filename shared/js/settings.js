import { supabase } from './supabase.js';

const DEFAULTS = {
  'store.name': 'Hasswell London',
  'store.tagline': 'Considered objects for the modern British home.',
  'store.email': 'hello@hasswelllondon.co.uk',
  'store.phone': '',
  'store.address': 'London, United Kingdom',
  'store.currency': 'GBP',
  'store.announcement': '',
  'shipping.flat_rate_minor': 0,
  'shipping.free_threshold_minor': 0,
  'shipping.estimate': '',
  'shipping.regions': ['GB'],
  'shipping.returns_window_days': 30,
  'legal.company_number': '',
  'legal.vat_number': ''
};

let cache = null;
let pending = null;

/**
 * Public store settings are readable by anonymous users when is_public = true.
 * Values are cached for the page lifetime.
 */
export async function getSettings() {
  if (cache) return cache;
  if (pending) return pending;

  pending = (async () => {
    if (!supabase) return { ...DEFAULTS };
    const { data, error } = await supabase.from('store_settings').select('key, value').eq('is_public', true);
    if (error) {
      console.warn('[settings] Could not load public settings:', error.message);
      return { ...DEFAULTS };
    }
    const merged = { ...DEFAULTS };
    for (const row of data ?? []) merged[row.key] = row.value;
    cache = merged;
    return merged;
  })().finally(() => {
    pending = null;
  });

  return pending;
}

export function clearSettingsCache() {
  cache = null;
}
