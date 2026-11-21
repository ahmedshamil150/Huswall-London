import { manualPaymentInstructions, isManualPaymentConfigured } from '../../api/_lib/orders.js';
import { PaymentError } from './provider.js';

/**
 * Manual bank transfer.
 *
 * The customer is shown the store's configured bank details. An administrator
 * verifies the incoming transfer against the bank statement and marks the order
 * as paid. Nothing here pretends payment has happened automatically.
 */
export const manualPaymentProvider = {
  name: 'manual',

  isConfigured() {
    return isManualPaymentConfigured();
  },

  async createPayment({ order }) {
    if (!isManualPaymentConfigured()) {
      throw new PaymentError(
        'PAYMENT_NOT_CONFIGURED',
        'Bank transfer details have not been configured yet.',
        { status: 503 }
      );
    }

    return {
      provider: 'manual',
      reference: null,
      redirect_url: null,
      instructions: manualPaymentInstructions(order.order_number),
      amount_minor: order.total_minor,
      currency: order.currency || 'GBP'
    };
  }
};
