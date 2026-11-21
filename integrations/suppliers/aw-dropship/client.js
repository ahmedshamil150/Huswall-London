/**
 * AW Dropship REST client.
 *
 * Documented behaviour used here (AW Dropship "Manual / API" channel):
 *  * Bearer token authentication.
 *  * Rate limit: 120 requests/minute.
 *  * Catalogue: GET /dropshipping/my-products-data-feed-json (JSON feed) with
 *    GET /dropshipping/products/my-products as a paginated fallback.
 *  * Orders: GET /dropshipping/order/{order} for status polling.
 *
 * Order *submission* body shapes are not publicly documented. Methods that
 * would guess them are intentionally absent; see submitOrder().
 */

import { SupplierError, SupplierNotConfiguredError, SupplierSubmissionUnverifiedError } from '../connector.js';

const DEFAULT_BASE = 'https://api.aiku.io';

export class AwDropshipClient {
  constructor({ baseUrl = DEFAULT_BASE, token, timeoutMs = 20000 } = {}) {
    if (!token) throw new SupplierNotConfiguredError('AW_DROPSHIP_API_TOKEN is not configured.');
    this.baseUrl = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
    this.token = token;
    this.timeoutMs = Math.min(Math.max(Number(timeoutMs) || 20000, 5000), 45000);
  }

  async request(path, { method = 'GET', query = null, body = undefined } = {}) {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new SupplierError(
        'SUPPLIER_NETWORK_ERROR',
        'The supplier service could not be reached. Please try again shortly.',
        { status: 504 }
      );
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const providerMessage =
        payload?.message || payload?.error?.message || payload?.error || `Supplier responded ${response.status}.`;
      throw new SupplierError(
        response.status === 401 || response.status === 403 ? 'SUPPLIER_UNAUTHORISED' : 'SUPPLIER_REQUEST_FAILED',
        String(providerMessage).slice(0, 300),
        { status: 502 }
      );
    }

    return payload;
  }

  /** Full product data feed (preferred — documented JSON feed). */
  async getProductDataFeed() {
    return this.request('/dropshipping/my-products-data-feed-json');
  }

  /** Paginated fallback when the feed is unavailable. */
  async listMyProducts({ page = 1, perPage = 100 } = {}) {
    return this.request('/dropshipping/products/my-products', {
      query: { page, per_page: perPage }
    });
  }

  async getOrder(orderReference) {
    if (!orderReference) throw new SupplierError('SUPPLIER_INVALID_REQUEST', 'Order reference is required.', { status: 400 });
    return this.request(`/dropshipping/order/${encodeURIComponent(orderReference)}`);
  }

  /**
   * Intentionally not implemented.
   *
   * AW documents the endpoints (POST /dropshipping/clients,
   * POST /dropshipping/order/client/{client}/store, PATCH
   * /dropshipping/order/{order}/submit) but the request body schemas are only
   * available inside the authenticated API documentation. Guessing them could
   * create malformed or duplicate supplier orders. Orders are therefore
   * submitted manually (or by a future verified adapter) until the client's
   * token holder confirms the exact payloads.
   */
  async submitOrder() {
    throw new SupplierSubmissionUnverifiedError(
      'Automated AW Dropship order submission has not been verified. Submit this order in the AW Dropship dashboard, then record the supplier reference in the admin panel.'
    );
  }
}
