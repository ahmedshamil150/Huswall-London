import { env, flags } from '../../api/_lib/env.js';
import { manualPaymentProvider } from './manual.js';
import { createStripeCheckout, isStripeConfigured } from './stripe.js';

/**
 * Payment registry.
 *
 * getPaymentProvider() returns null when the selected provider is not fully
 * configured. The storefront then disables checkout instead of accepting an
 * order it cannot take payment for.
 */
const stripePaymentProvider = {
  name: 'stripe',
  isConfigured: isStripeConfigured,
  async createPayment({ order, items, successUrl, cancelUrl }) {
    return createStripeCheckout({ order, items, successUrl, cancelUrl });
  }
};

const PROVIDERS = {
  manual: manualPaymentProvider,
  stripe: stripePaymentProvider
};

export function selectedPaymentProviderName() {
  const name = String(flags.paymentProvider || '').trim().toLowerCase();
  return PROVIDERS[name] ? name : null;
}

export function getPaymentProvider() {
  const name = selectedPaymentProviderName();
  if (!name) return null;
  const provider = PROVIDERS[name];
  return provider.isConfigured() ? provider : null;
}

export function paymentProviderStatus() {
  const name = selectedPaymentProviderName();
  return {
    selected: name,
    configured: Boolean(name && PROVIDERS[name]?.isConfigured()),
    available: Boolean(getPaymentProvider())
  };
}

export function requirePaymentProvider() {
  const provider = getPaymentProvider();
  if (!provider) {
    const name = selectedPaymentProviderName();
    const error = new Error(
      name
        ? `The configured payment provider (${name}) is not fully configured.`
        : `PAYMENT_PROVIDER must be "manual" or "stripe".`
    );
    error.code = 'PAYMENT_PROVIDER_UNAVAILABLE';
    error.status = 503;
    error.expose = true;
    throw error;
  }
  return provider;
}

export function isProductionPaymentMode() {
  return flags.paymentProvider === 'stripe' && isStripeConfigured() && env('VERCEL_ENV') === 'production';
}
