import { env, flags } from '../../../api/_lib/env.js';
import { SupplierNotConfiguredError } from '../connector.js';
import { AwDropshipClient } from './client.js';
import { normaliseFeed, extractRows, mapOrderStatus, extractTracking } from './mapper.js';

/**
 * AW Dropship connector.
 *
 * Only documented operations are exposed. Order submission remains manual until
 * the authenticated API documentation confirms the exact request bodies and the
 * flow has been verified against the client's live account.
 */
export class AwDropshipConnector {
  constructor(account) {
    this.account = account;
    const credentialsRef = String(account?.credentials_ref || 'AW_DROPSHIP_API_TOKEN');
    const token = /^[A-Z0-9_]+$/.test(credentialsRef) ? env(credentialsRef) : null;

    this.client = new AwDropshipClient({
      baseUrl: env('AW_DROPSHIP_BASE_URL') || account?.api_base_url || 'https://api.aiku.io',
      token,
      timeoutMs: env('AW_DROPSHIP_TIMEOUT_MS', '20000')
    });
  }

  capabilities() {
    return {
      productImport: true,
      stockSync: true,
      priceSync: true,
      orderStatusPolling: true,
      tracking: true,
      webhooks: false,
      verifiedLive: false,
      // Automated submission stays off even when the master switch is set:
      // the payload schema must be verified and implemented first.
      orderSubmission: false,
      orderSubmissionRequested: flags.awOrderSubmissionEnabled,
      manualSubmissionRequired: true
    };
  }

  assertConfigured() {
    if (!this.client?.token) {
      throw new SupplierNotConfiguredError('AW_DROPSHIP_API_TOKEN is not configured.');
    }
  }

  async fetchCatalogue() {
    this.assertConfigured();

    let payload = null;
    try {
      payload = await this.client.getProductDataFeed();
    } catch (error) {
      // The feed is the documented path; the paginated endpoint is the fallback.
      console.warn('[aw-dropship] data feed unavailable, falling back to paginated products:', error.message);
    }

    let products = normaliseFeed(payload);
    if (products.length) return products;

    const rows = [];
    const perPage = 100;
    for (let page = 1; page <= 50; page += 1) {
      const result = await this.client.listMyProducts({ page, perPage });
      const pageRows = extractRows(result);
      rows.push(...pageRows);
      if (pageRows.length < perPage) break;
    }

    products = normaliseFeed({ data: rows });
    return products;
  }

  async getOrderStatus(reference) {
    this.assertConfigured();
    const payload = await this.client.getOrder(reference);
    const row = payload?.order ?? payload?.data ?? payload ?? {};
    return {
      status: mapOrderStatus(row.status ?? row.order_status ?? row.orderStatus),
      rawStatus: row.status ?? null,
      tracking: extractTracking(payload),
      raw: payload
    };
  }

  /**
   * Deliberately unavailable. See AwDropshipClient.submitOrder().
   */
  async submitOrder() {
    return this.client.submitOrder();
  }
}
