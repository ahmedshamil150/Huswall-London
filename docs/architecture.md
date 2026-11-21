# Architecture

Hasswell London is a multi-page storefront plus a separate admin SPA and a
serverless API. The browser never talks to a privileged service directly:
catalogue reads use the Supabase anon key under RLS, and every state-changing
operation goes through `/api`.

## High-level shape

```text
Browser
  ├── Store pages (store/*.html + store/js/*)
  │     ├── Supabase anon client  ──► published catalogue, own profile/orders (RLS)
  │     └── /api/*                ──► cart validation, checkout, order status
  └── Admin SPA (admin/index.html + hash routes)
        ├── Supabase Auth         ──► session token
        └── /api/admin/*          ──► Bearer token + service role, admin checks

Vercel serverless functions (/api)
  ├── api/_lib/*                  ──► env, HTTP, validation, orders, email, admin
  ├── integrations/payments/*     ──► manual | stripe registry
  ├── integrations/suppliers/*    ──► AW Dropship connector + sync
  └── Supabase service role       ──► SECURITY DEFINER functions and transactional writes
```

Why this split:

- Product browsing stays fast and cache-friendly.
- Money, stock and fulfilment logic lives in one place (Postgres functions),
  reachable only with the service role.
- Adding a payment provider or supplier does not require rewriting checkout or
  the storefront.

## Repository map

| Path | Responsibility |
| --- | --- |
| `store/` | Customer pages, page scripts, storefront styles |
| `admin/` | Admin shell, views, admin styles |
| `shared/js/` | Browser modules shared by storefront pages |
| `api/_lib/` | Server helpers and domain services |
| `api/admin/` | Admin-only API endpoints |
| `integrations/payments/` | Provider contract, registry, manual and Stripe |
| `integrations/suppliers/` | Connector contract, registry, AW Dropship adapter |
| `supabase/migrations/` | Schema, RLS, functions, seed, storage, operations |
| `tests/` | Unit tests; no network or database required |

## Storefront

### Boot sequence

Each page includes a small module script. A typical page calls
`initLayout()` from `shared/js/layout.js`, which:

1. loads public settings from `store_settings` (cached for the page lifetime);
2. renders the announcement bar, header, navigation, search and footer;
3. initialises the cart count and mobile drawer;
4. applies the store name, currency and contact details.

`shared/js/page-boot.js` wraps page startup so an unexpected error renders a
readable message instead of a blank page.

### Key browser modules

| Module | Purpose |
| --- | --- |
| `config.js` | Public `VITE_*` values, currency, cart storage key |
| `supabase.js` | Single browser Supabase client and configuration guard |
| `auth.js` | Session, profile, sign-in/up/out, customer and admin guards |
| `cart.js` | localStorage cart containing identifiers and quantities only |
| `catalog.js` | Published product queries, mapping, filters and search |
| `settings.js` | Public store settings with safe defaults |
| `api.js` | `fetch` wrapper that attaches the Supabase access token |
| `seo.js` | Titles, canonical URLs, Open Graph, Twitter and JSON-LD |
| `layout.js` | Header, footer, drawer, announcement and cart count |
| `money.js` | Integer-pence formatting and safe input parsing |
| `dom.js` | DOM helpers, escaping, toasts, busy states, icons |

### Cart storage

The cart in `localStorage` contains only:

```json
{ "product_id": "uuid", "variant_id": "uuid-or-null", "quantity": 2 }
```

It contains no prices. `/api/cart/validate` returns authoritative names, prices,
availability and totals. Checkout repeats validation before creating an order.

## Admin SPA

`admin/index.html` loads `admin/js/app.js`. The app:

1. requires a Supabase session;
2. loads the caller's profile;
3. redirects non-admins to `/admin/login?error=forbidden`;
4. renders the shell and a hash route such as `#/orders`.

Routes: `#/dashboard`, `#/products`, `#/products/new`, `#/products/:id`,
`#/orders`, `#/orders/:id`, `#/inventory`, `#/supplier`, `#/messages`,
`#/settings`.

`admin/js/api.js` calls `/api/admin/*` with the session's Bearer token. A 401 or
403 dispatches `admin:unauthorised`, which clears the view and returns the user
to sign-in. Server-side `requireAdmin()` is the real gate; hiding UI is only a
convenience.

## API

### Public endpoints

| Method | Path | Purpose | Rate limit |
| --- | --- | --- | --- |
| GET | `/api/store/config` | Public currency, shipping regions, provider availability | 120/min |
| GET | `/api/health` | Capability and database health (no secrets) | none |
| GET | `/api/sitemap`, `/api/robots` | Generated SEO files | none |
| POST | `/api/cart/validate` | Authoritative cart lines and totals | 120/min |
| POST | `/api/checkout/create-order` | Create order, reserve stock, start payment | 8/10 min, fail-closed |
| POST | `/api/checkout/retry-payment` | New payment session for an unpaid order | 10/10 min, fail-closed |
| POST | `/api/payments/webhook` | Stripe-signed payment events | signature-gated |
| GET | `/api/orders/status?order=&token=` | Customer order and tracking | 120/min |
| POST | `/api/newsletter` | Newsletter signup | 5/hour |
| POST | `/api/contact` | Contact form and optional notification email | 5/hour |
| GET/POST | `/api/cron/sync-supplier` | Cron: supplier sync, expired releases, pruning | `CRON_SECRET` |

### Admin endpoints

All require a Supabase Bearer token whose profile is an active administrator.
The server verifies the token with Supabase, then uses the service role.

| Path | Purpose |
| --- | --- |
| `/api/admin/dashboard` | Aggregated counts, revenue, recent orders, best sellers |
| `/api/admin/products`, `/api/admin/products/:id` | Product list, create, edit, archive |
| `/api/admin/categories`, `/api/admin/categories/:id` | Category management |
| `/api/admin/orders`, `/api/admin/orders/:id` | Search, detail, payment, status, shipment, notes |
| `/api/admin/inventory` | Stock list and adjustments |
| `/api/admin/settings` | Public/private store settings |
| `/api/admin/suppliers` | Supplier status, test, sync, toggle, update |
| `/api/admin/messages` | Contact messages |
| `/api/admin/newsletter` | Subscribers |
| `/api/admin/email-log` | Transactional email audit trail |

`api/_lib/http.js` wraps every handler with consistent JSON errors, method
checks, body limits and security headers. Errors expose a stable `code` and a
safe `message`; internal database or provider details are logged server-side.

### Request and error shape

Successful responses are JSON with `ok: true` and the payload at the top level.
Errors:

```json
{
  "ok": false,
  "error": {
    "code": "CART_CHANGED",
    "message": "Availability has changed since you reviewed your bag…",
    "details": { "issues": [] }
  }
}
```

## Checkout and order lifecycle

### Creation

1. The browser posts identifiers, quantities, customer details and
   `terms_accepted`, with an `Idempotency-Key`.
2. The server rate-limits the request and validates every field.
3. `resolveCart()` reloads products, variants and stock from Supabase.
4. Shipping is calculated from store settings. The browser does not choose it.
5. `create_order()` runs one Postgres transaction:
   - validates the customer and address;
   - aggregates duplicate lines;
   - locks inventory rows (`for update`);
   - recalculates prices and totals from the database;
   - rejects insufficient stock;
   - inserts the order, items, customer and reservation movements;
   - returns the order number and private access token.
6. The server starts payment through the selected provider.
7. If payment initialisation fails, the order remains reserved and the customer
   is told to retry payment; the event is recorded. Reservations expire after
   24 hours.
8. The order-received email is recorded/sent.

A repeated `Idempotency-Key` returns the original order and never creates a
second payment session.

### Status model

Payment and fulfilment are independent:

```text
payment_status:    pending → paid → refunded / partially_refunded
                   pending → failed / cancelled

fulfilment/order:  pending_payment
                   → awaiting_supplier        (only after verified payment)
                   → submitted_to_supplier
                   → supplier_processing
                   → dispatched               (requires carrier + tracking)
                   → delivered
                   → cancelled / failed
```

`mark_order_paid()`:

- refuses cancelled or failed orders;
- requires the amount to cover the order total and the currency to match;
- rejects a provider reference already used by another order;
- commits reserved stock, increments sales counts and sets
  `awaiting_supplier`;
- records a `payment_confirmed` event and triggers the confirmation email.

`cancel_order()` restores stock correctly whether payment was pending
(release the reservation) or paid (return committed units), and records the
reason. `release_expired_orders()` uses it for unpaid orders older than 24 hours.

`record_shipment()` is the only path to `dispatched`. It requires a paid order
and a tracking number, and refuses cancelled/failed orders. The admin form asks
for both carrier and tracking; supplier polling may provide the tracking number
without a carrier. The admin UI therefore does not offer "dispatched" as a
generic status change.

## Payments

`integrations/payments/registry.js` selects a provider from `PAYMENT_PROVIDER`.

### Manual bank transfer

- Shows configured bank details and the order number as the payment reference.
- Never marks anything paid.
- An administrator checks the bank statement and uses **Mark paid** in the
  admin order view. The reference and verifying admin are recorded.

### Stripe

- Creates a hosted Checkout session via Stripe's REST API (no SDK).
- Collects card data on Stripe's domain. The application never sees card data.
- Adds delivery as a separate line when shipping is non-zero, so the session
  total matches the order total.
- Expires the session after one hour.
- `/api/payments/webhook` uses Vercel's web-standard `POST(request)` handler so
  `request.text()` preserves the exact bytes. It verifies `Stripe-Signature`
  HMAC-SHA256 over `${timestamp}.${rawBody}` with a 300-second tolerance before
  parsing or writing anything. A Node `(req, res)` handler would receive an
  already-parsed body and break the signature.
- Only `checkout.session.completed` with `payment_status = paid`, or
  `checkout.session.async_payment_succeeded`, can mark an order paid.
- Returning non-2xx on a processing failure lets Stripe retry safely.

Provider availability is reported publicly as booleans only. A misconfigured
provider disables checkout instead of accepting unpayable orders.

## Supplier integration

The connector contract lives in `integrations/suppliers/connector.js`; the
registry only instantiates implemented connectors. Unknown suppliers fail loudly.

The AW Dropship adapter:

- reads the documented JSON product feed, with a paginated endpoint fallback;
- upserts `supplier_products`, linking by exact SKU;
- applies stock through `apply_supplier_stock_batch()`;
- polls order status and applies tracking only when the supplier confirms
  dispatch;
- has **no automated order submission**. See [aw-dropship.md](aw-dropship.md).

Supplier accounts store only a `credentials_ref` (an environment variable name),
never the token itself. Tokens are read server-side at request time.

## Email

`api/_lib/email.js` has two providers:

- `log` (default): records the intended message in `email_log` with status
  `logged`; nothing is sent.
- `resend`: real delivery once `RESEND_API_KEY` and a verified `EMAIL_FROM`
  exist; records `sent` or `failed`.

Order and payment flows use `sendSafely()`: email failure never rolls back an
order or a payment. The admin Email log shows what happened.

## SEO and accessibility

- `shared/js/seo.js` sets titles, descriptions, canonicals, Open Graph, Twitter
  cards and JSON-LD (organisation, product, breadcrumbs).
- `/api/sitemap` generates static pages, active categories and active products.
- `/api/robots` points to the sitemap and disallows admin and account routes.
- Pages use semantic landmarks, visible focus styles, skip links, labelled form
  controls, live regions for errors and reduced-motion support.
- Colour and type are defined once in `store/styles/main.css`; admin has its own
  stylesheet.

## Extending the system

### Add a payment provider

1. Implement the provider contract in `integrations/payments/`.
2. Register it in `registry.js` with an `isConfigured()` check.
3. Add env names to `.env.example` and the deployment docs.
4. Verify its webhook or server-side confirmation path before enabling.
5. Never mark an order paid from a browser callback.

### Add a supplier

1. Implement the operations in `integrations/suppliers/connector.js`.
2. Map its data in a dedicated adapter folder.
3. Register the connector and seed an inactive `supplier_accounts` row.
4. Keep order submission disabled until payloads are verified against the
   supplier's authenticated documentation.
5. Apply stock only through `apply_supplier_stock_batch()` so reservations are
   respected and movements are audited.

### Add a new store page

1. Create `store/page.html` with the shared header/footer placeholders.
2. Create `store/js/page.js` and call `initLayout()` and `setMeta()`.
3. Add the page to `vite.config.js` `input` and the `cleanUrlsDev` map.
4. Add the rewrite to `vercel.json`.
5. Add the page to `api/sitemap.js` if it should be indexed.
