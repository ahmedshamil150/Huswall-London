/**
 * Public runtime configuration.
 * Only VITE_* values are bundled into the browser. Server secrets must never
 * be referenced here.
 */
const env = import.meta.env;

export const config = {
  supabaseUrl: env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY ?? '',
  siteUrl: env.VITE_STORE_URL || window.location.origin,
  gaMeasurementId: env.VITE_GA_MEASUREMENT_ID ?? '',
  googleSiteVerification: env.VITE_GOOGLE_SITE_VERIFICATION ?? ''
};

export const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);

export const CURRENCY = 'GBP';
export const CART_STORAGE_KEY = 'hl_cart_v1';
