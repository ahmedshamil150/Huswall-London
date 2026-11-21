/**
 * Server environment access.
 *
 * These variables must be configured in Vercel (and in .env locally). No
 * server-only value may ever be exposed with a VITE_ prefix.
 */

export function env(name, fallback = undefined) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
}

export function requireEnv(name) {
  const value = env(name);
  if (!value) {
    const error = new Error(`Missing required environment variable: ${name}`);
    error.code = 'CONFIGURATION_ERROR';
    error.status = 500;
    throw error;
  }
  return value;
}

export function siteUrl() {
  const explicit = env('PUBLIC_SITE_URL') || env('VITE_STORE_URL');
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = env('VERCEL_URL');
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:5173';
}

export function isProduction() {
  return env('VERCEL_ENV') === 'production' || env('NODE_ENV') === 'production';
}

export const flags = {
  get awOrderSubmissionEnabled() {
    return env('AW_DROPSHIP_ORDER_SUBMISSION_ENABLED', 'false') === 'true';
  },
  get emailProvider() {
    return env('EMAIL_PROVIDER', 'log');
  },
  get paymentProvider() {
    return env('PAYMENT_PROVIDER', 'manual');
  }
};
