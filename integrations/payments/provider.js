/**
 * Payment provider contract.
 *
 * Providers create a hosted or manual payment instruction and never accept raw
 * card details. Verification of a completed payment must always happen
 * server-side (webhook signature or administrator confirmation) before
 * mark_order_paid() is called.
 */

export class PaymentError extends Error {
  constructor(code, message, { status = 502, details = undefined } = {}) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
