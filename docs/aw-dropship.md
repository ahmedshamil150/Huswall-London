# AW Dropship integration and feasibility

This document records what was verified about AW Dropship, what was
implemented, and what remains unavailable. It exists so nobody mistakes the
supplier integration for a completed live connection.

> **Bottom line:** catalogue and stock synchronisation are implemented against
> AW's documented JSON feed. Automated order submission is **not** implemented
> because AW does not publish the request body schemas. Orders are submitted
> manually in the AW dashboard and recorded in the admin panel. Nothing in this
> repository pretends otherwise.

## Scope of the research

The integration was designed for AW Dropship's **Manual / API** channel, which
exposes a Bearer-token REST API used by AW's own manual-channel tooling.

Verified at the time of research:

- **Authentication:** Bearer token generated per channel in the AW dashboard.
- **Base URLs:** `https://api.aiku.io` for live and
  `https://api.aiku-sandbox.uk` for staging.
- **Rate limit:** 120 requests per minute.
- **Catalogue:** JSON product data feed, plus a paginated product listing.
- **Orders:** clients, orders, order submission and transaction endpoints.
- **Products and images:** product and image endpoints.
- **Webhooks:** no publicly documented webhook subscription. Status must be
  polled.

Not verified, and therefore not implemented:

- The exact JSON request bodies for creating a client, creating an order,
  submitting an order, or selecting delivery options.
- The precise meaning and error codes of every order/transaction state.
- Whether the client's AW plan includes API access.
- Whether a live channel can be created without a saved card or account balance.
- Any sandbox entitlement for this project.

The endpoint shapes for order creation are only available inside AW's
authenticated documentation, which requires the client's token holder. Guessing
them could create malformed orders or duplicate charges at the supplier.

## Implemented behaviour

### Connector contract

`integrations/suppliers/connector.js` defines the supplier contract and typed
errors. `integrations/suppliers/registry.js` maps connector names to
implementations and throws for unknown names. AW is the only registered
connector: `aw-dropship`.

`integrations/suppliers/aw-dropship/client.js` performs the HTTP calls:

| Operation | Endpoint | Used |
| --- | --- | --- |
| Product data feed | `GET /dropshipping/my-products-data-feed-json` | Preferred |
| Paginated products | `GET /dropshipping/products/my-products?page=&per_page=` | Fallback, max 50 pages × 100 |
| Order status | `GET /dropshipping/order/{order}` | Polling |
| Client/order creation/submission | — | **Not implemented** |

The client:

- sends `Authorization: Bearer <token>` and `Accept: application/json`;
- uses a timeout between 5 and 45 seconds (`AW_DROPSHIP_TIMEOUT_MS`, default
  20 seconds);
- maps 401/403 to `SUPPLIER_UNAUTHORISED` and other failures to a safe supplier
  error without leaking the token;
- never logs the token.

### Capabilities advertised to the admin panel

```js
{
  productImport: true,
  stockSync: true,
  priceSync: true,
  orderStatusPolling: true,
  tracking: true,
  webhooks: false,
  verifiedLive: false,
  orderSubmission: false,
  orderSubmissionRequested: <AW_DROPSHIP_ORDER_SUBMISSION_ENABLED>,
  manualSubmissionRequired: true
}
```

`AW_DROPSHIP_ORDER_SUBMISSION_ENABLED=true` records intent only. It does not
enable submission; `submitOrder()` always throws
`SUPPLIER_ORDER_SUBMISSION_UNVERIFIED`.

### Catalogue mapping

`mapper.js` is deliberately tolerant because AW feed fields can vary by
workspace:

- Row lists are found under `data`, `products`, `items`, `results`, `result`,
  `my_products`, `myProducts` or `records`, including one nested level.
- SKU aliases: `supplier_sku`, `supplierSku`, `sku`, `SKU`, `product_code`,
  `productCode`, `code`.
- Rows without a SKU are skipped. Nothing is invented.
- Names longer than 300 characters are truncated.
- Stock aliases include `stock`, `stock_level`, `stock_quantity`, `quantity`,
  `qty`, `available` and camelCase variants.
- A missing stock value stays `null`. **It is never treated as zero.**
- Prices:
  - fields ending in `_minor`/`Minor` are treated as integer pence;
  - generic price/RRP fields are treated as decimal major units and converted
    to pence with rounding;
  - invalid prices are rejected, not guessed.
- Duplicate SKUs collapse to the first row.

### Stock synchronisation

`sync-service.js`:

1. resolves the active supplier account (or a specified one);
2. opens a `supplier_sync_logs` row with status `running`;
3. fetches the feed, falling back to the paginated endpoint;
4. optionally creates **draft** products for unmatched SKUs;
5. upserts `supplier_products`, linking by exact case-insensitive SKU;
6. applies stock in chunks through `apply_supplier_stock_batch()`;
7. updates supplier capabilities and closes the log with counts.

Important behaviour:

- New supplier products are created as `draft`, never published. Retail copy,
  images and pricing require a human.
- Only rows with an explicit stock value are applied.
- Supplier stock cannot reduce on-hand stock below existing reservations:
  `stock_on_hand = greatest(supplier_stock, stock_reserved)`.
- Every change writes an `inventory_movements` row with reason
  `supplier_sync`.
- Supplier prices are stored on `supplier_products`. They are **not**
  automatically pushed to retail prices.
- A supplier error is recorded in the log and returned as a safe error; it does
  not roll back unrelated store data.

The cron endpoint `GET /api/cron/sync-supplier` runs the sync, releases unpaid
orders older than 24 hours, and prunes operational tables. The committed Vercel
schedule is daily (`0 3 * * *`) because Hobby accounts cannot run more frequent
cron jobs; Vercel Pro or an external scheduler can call the same endpoint every
one to two hours. The request must carry
`Authorization: Bearer <CRON_SECRET>`.

Stock freshness is therefore a plan decision. If the store stays on Hobby, run a
manual **Sync catalogue** before a busy trading period or move to Pro for
two-hourly updates.

### Order status polling

`refreshSupplierOrderStatus(supplierOrderId)`:

1. loads the supplier order and its account;
2. calls `GET /dropshipping/order/{external_order_id || external_reference}`;
3. maps the status text onto `supplier_order_status`;
4. stores the raw payload, attempt count and tracking fields;
5. only calls `record_shipment()` when the supplier reports a dispatch **and**
   returns a tracking number;
6. updates our order to `supplier_processing` when the supplier reports
   processing.

`record_shipment()` re-checks in SQL that the order is paid, not cancelled or
failed, and that a tracking number is present. A supplier status alone can never
mark an unpaid order dispatched.

Status mapping is heuristic and tolerant:

| Supplier text contains | Mapped status |
| --- | --- |
| `dispatch` | `dispatched` |
| `delivered` | `delivered` |
| `cancel` | `cancelled` |
| `fail`, `error` | `failed` |
| `pack`, `pick`, `warehouse`, `final` | `processing` |
| `submit` | `submitted` |
| anything else | `pending` |

Tracking fields are read from common aliases (`tracking_number`,
`trackingNumber`, `tracking_no`, `consignment_number`, `carrier`, `courier`,
`tracking_url`, `tracking_link`) and may be nested under `order` or `data`.

## Manual order submission (current process)

Automated submission is unavailable, so paid orders are placed in AW by hand.

1. Confirm the order is **paid** in Admin → Orders. The `submit_supplier`
   action refuses unpaid orders.
2. Open the AW Dropship dashboard.
3. Create the order for the customer using the delivery address and items shown
   in the admin order detail.
4. Record the AW order reference in the admin panel and choose **Record manual
   submission**.
5. The panel creates or updates `supplier_orders` with:
   - `status = 'submitted'`;
   - `external_reference = order_number`;
   - `external_order_id` (if provided);
   - `raw_payload.manual = true` and the submitting admin's email;
   - `attempts` incremented.
6. The order status becomes `submitted_to_supplier`.
7. Later, use **Poll status** on the supplier record to retrieve processing,
   dispatch and tracking updates.

This action records what a human did. It does not contact AW.

### Why not simulate submission?

A fake success would be worse than a clear refusal:

- The customer would be told the supplier has the order when it does not.
- Stock would appear allocated when it is not.
- Retrying could create duplicate supplier orders.
- Payment and fulfilment records would become untrustworthy.

The refusal is explicit in the API:

```text
SUPPLIER_ORDER_SUBMISSION_UNVERIFIED
Automated AW Dropship order submission has not been verified. Submit this order
in the AW Dropship dashboard, then record the supplier reference in the admin panel.
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `AW_DROPSHIP_API_TOKEN` | Bearer token from the AW channel |
| `AW_DROPSHIP_BASE_URL` | `https://api.aiku.io` or the staging URL |
| `AW_DROPSHIP_ORDER_SUBMISSION_ENABLED` | Intent flag only; does not enable submission |
| `AW_DROPSHIP_DEFAULT_CARRIER` | Reserved for a future verified submission adapter; currently unused |
| `AW_DROPSHIP_TIMEOUT_MS` | HTTP timeout, clamped to 5–45 seconds |

The database stores only `supplier_accounts.credentials_ref`, the **name** of
the environment variable. The token itself never enters the database or the
browser.

The seeded supplier account is inactive:

```sql
select name, slug, connector, is_active, credentials_ref
from supplier_accounts;
```

Activate it in Admin → Supplier after the token is configured. The admin
**Test connection** action is read-only and reports how many products were found
without writing data.

## Enabling automated submission later

Do not start coding from assumptions. Complete this checklist first:

1. **Obtain the authenticated API documentation** from the client's AW token
   holder. Capture request and response examples for:
   - client creation;
   - order creation;
   - delivery option selection;
   - order submission;
   - transaction/status retrieval.
2. **Confirm commercial access.** The client's AW plan must include API access,
   and the channel must have a valid payment method or balance.
3. **Verify in staging** against `https://api.aiku-sandbox.uk` if access is
   granted. Never test with a real customer order.
4. **Define idempotency.** AW must accept a stable client reference; otherwise
   implement a reconciliation step that searches existing orders before retrying.
5. **Implement `AwDropshipClient.submitOrder()`** with the confirmed payload.
6. **Return a verified capability.** Set `orderSubmission: true` and
   `verifiedLive: true` only after a successful staging round-trip.
7. **Add status reconciliation.** Because AW has no public webhooks, polling must
   remain the source of dispatch/tracking updates.
8. **Update this document** with the verified shapes, date, environment and
   tester.
9. **Re-run tests** and add fixtures for the real payloads.
10. **Only then** consider honouring `AW_DROPSHIP_ORDER_SUBMISSION_ENABLED`.

Relevant files:

- `integrations/suppliers/aw-dropship/client.js` — HTTP operations.
- `integrations/suppliers/aw-dropship/connector.js` — capabilities and calls.
- `integrations/suppliers/aw-dropship/sync-service.js` — sync and polling.
- `api/admin/orders/[id].js` — `submit_supplier`, `sync_supplier` actions.

## Operational risks

| Risk | Mitigation |
| --- | --- |
| AW changes feed field names | Tolerant mapper; sync logs record failures; verify samples after changes |
| Missing stock field is misread | Explicit `null`; never applied as zero |
| Supplier stock undercuts reservations | SQL clamps to `stock_reserved` |
| Rate limit (120/min) | Sequential calls, max 50 product pages per sync |
| No webhooks | Cron polling and manual status checks |
| Token leak | Server-only env var; `credentials_ref` stores only the variable name |
| Duplicate manual orders | Admin records one `supplier_orders` row per order and increments attempts |
| Unverified dispatch claims | `record_shipment()` requires paid + carrier + tracking |

## Re-verification

AW's API is external and can change. Before launch, and after any AW account or
plan change, repeat:

1. **Test connection** in Admin → Supplier.
2. Run a **catalogue sync** and compare a sample of SKUs, prices and stock with
   the AW dashboard.
3. Confirm a draft product is created only when explicitly requested.
4. Place a low-value test order, mark it paid, submit manually and poll status.
5. Confirm tracking appears only after AW confirms dispatch.
6. Record the date and result in this document.
