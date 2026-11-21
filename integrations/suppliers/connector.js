/**
 * Supplier connector contract.
 *
 * A connector is deliberately small and independent from payment and order
 * code. Adding a second supplier means implementing this shape and registering
 * it — no changes to checkout or the admin order screens are required.
 *
 * Capability flags are advisory: they describe what the connector is allowed to
 * attempt *in this deployment*, not merely what the supplier's API supports.
 */

export class SupplierError extends Error {
  constructor(code, message, { status = 502, details = undefined, expose = true } = {}) {
    super(message);
    this.name = 'SupplierError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = expose;
  }
}

export class SupplierNotConfiguredError extends SupplierError {
  constructor(message = 'The supplier connection is not configured yet.') {
    super('SUPPLIER_NOT_CONFIGURED', message, { status: 503 });
  }
}

export class SupplierSubmissionUnverifiedError extends SupplierError {
  constructor(message = 'Automated order submission has not been verified for this supplier.') {
    super('SUPPLIER_ORDER_SUBMISSION_UNVERIFIED', message, { status: 409 });
  }
}

/**
 * @typedef {object} SupplierCapabilities
 * @property {boolean} productImport
 * @property {boolean} stockSync
 * @property {boolean} priceSync
 * @property {boolean} orderSubmission
 * @property {boolean} orderStatusPolling
 * @property {boolean} tracking
 * @property {boolean} webhooks
 * @property {boolean} verifiedLive
 * @property {boolean} manualSubmissionRequired
 */

/**
 * @typedef {object} NormalisedSupplierProduct
 * @property {string} supplierSku
 * @property {string|null} supplierProductId
 * @property {string} name
 * @property {number|null} priceMinor
 * @property {number|null} rrpMinor
 * @property {number|null} stock
 * @property {string|null} availability
 * @property {object} raw
 */
