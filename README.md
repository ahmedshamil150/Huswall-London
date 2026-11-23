# Hasswell London

Custom e-commerce and dropshipping platform for **Hasswell London**, built with
plain HTML, CSS and JavaScript ES modules on Vite, deployed to Vercel, with
Supabase for Postgres, authentication and storage.

There is no WordPress, WooCommerce, Shopify, Next.js, React or other frontend
framework in this repository. Product data lives in Supabase — nothing in the
storefront hardcodes a catalogue.

---

## Project status

This is a working application, not a visual prototype. The table below separates
what is implemented and testable from what still needs the client's commercial
accounts or credentials.

| Area | Status | Notes |
| --- | --- | --- |
| Storefront | Working | Home, shop, product, cart, checkout, confirmation, account, auth, editorial and legal pages. |
| Admin panel | Working | Dashboard, products, categories, orders, inventory, settings, supplier, messages, newsletter, email log. |
| Database and RLS | Working | Migrations `0001`–`0007`, row-level security, server-only domain functions. |
| Orders and stock | Working | Server-side pricing, transactional stock reservation, idempotent checkout, expiry release. |
| Manual bank transfer | Working when configured | Real instructions; an administrator verifies the transfer and marks the order paid. |
| Stripe Checkout | Implemented, credentials required | Real REST integration and signed webhook verification. Stripe account eligibility must be confirmed by the client. |
| Transactional email | Working | `log` provider records intent without sending; `resend` performs real delivery once configured. |
| AW Dropship catalogue/stock sync | Implemented, live verification pending | Uses AW's documented JSON product feed. Needs the client's API token and an active supplier account. |
| AW Dropship order submission | **Not automated** | AW's request body schemas are not publicly documented. The connector refuses to guess; orders are submitted manually and recorded in the admin panel. |
| Payments in production | Not enabled yet | Requires approved provider credentials, bank details and business confirmation. |

Read [docs/aw-dropship.md](docs/aw-dropship.md) before promising automated
supplier fulfilment. It records exactly what was verified, what was not, and why.

---

## Stack

- **Frontend:** HTML5, CSS3, vanilla JavaScript ES modules.
- **Build:** Vite 5.
- **Hosting:** Vercel (static output plus serverless functions in `/api`).
- **Database, auth, storage:** Supabase (Postgres, Supabase Auth, Storage).
- **Payments:** provider-agnostic registry with `manual` and `stripe` adapters.
- **Supplier:** connector-based integration with a single AW Dropship adapter.
- **Tests:** Node's built-in test runner.

Node.js **20.x** is required. The major version is pinned in `package.json`
(`engines.node`) and `.nvmrc` so Vercel does not move to a new major release
without review. Run `nvm use` before installing on a machine with several Node
versions.

---

## Quick start

```bash
npm install
copy .env.example .env      # Windows
# cp .env.example .env      # macOS / Linux
```

1. Create a Supabase project.
2. Run the SQL migrations in `supabase/migrations/` **in numeric order**.
3. Fill in the Supabase URL, anon key and service-role key in `.env`.
4. Create an account through `/register`, then promote it with
   `supabase/scripts/promote-admin.sql`.
5. Start the dev server:

```bash
npm run dev
```

Open `http://localhost:5173` for the store and
`http://localhost:5173/admin` for the admin panel.

`npm run dev` serves the pages and reads Supabase directly, but it does not run
the `/api` functions. Use `npx vercel dev` for cart validation, checkout,
order lookup and admin writes.

Detailed instructions, including the SQL editor workflow, are in
[docs/setup.md](docs/setup.md).

---

## URLs

| Path | Purpose |
| --- | --- |
| `/` | Storefront home |
| `/shop` | Catalogue with search, category and sort filters |
| `/product/:slug` | Product detail |
| `/cart`, `/checkout` | Cart and checkout |
| `/order-confirmation` | Order status and payment instructions |
| `/account` | Customer account and order history |
| `/login`, `/register` | Authentication |
| `/admin` | Admin SPA (hash routes such as `#/orders`) |
| `/api/health` | Operational health check |
| `/sitemap.xml`, `/robots.txt` | Generated SEO endpoints |

Clean URLs are produced by `vercel.json` rewrites in production and by a Vite
middleware during development. Both use the same path map.

---

## Project structure

```text
store/                  Customer-facing HTML pages, styles and page scripts
admin/                  Admin SPA shell, styles and hash-routed views
api/                    Vercel serverless endpoints
  _lib/                 Server helpers: env, HTTP, validation, orders, email, admin
  admin/                Admin-only endpoints (Bearer token + admin profile required)
  cart/ checkout/ orders/ payments/ store/ cron/
integrations/
  payments/             Provider contract, registry, manual and Stripe adapters
  suppliers/            Connector contract, registry, AW Dropship adapter and sync
shared/js/              Browser modules shared by storefront pages
supabase/
  migrations/           Schema, RLS, functions, seed, storage, operations
  scripts/              One-off operational SQL such as admin promotion
tests/                  Unit tests for money, validation, Stripe and AW mapping
public/                 Branded SVG artwork, favicon and Open Graph image
docs/                   Architecture, database, supplier, security and handover docs
vercel.json             Rewrites, cron schedule and security headers
vite.config.js          Multi-page build and development clean-URL middleware
```

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server with clean-URL middleware |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run all unit tests |
| `npm run lint` | Minimal syntax check used as a placeholder |

`npm run build` and `npm test` must both pass before deployment. The current
suite contains 24 tests covering money handling, validation, Stripe signature
verification, AW feed mapping and shipping/settings rules.

---

## Core design decisions

- **Money is integer minor units.** Prices, totals and refunds are stored in
  pence. The browser never supplies a price that is trusted by the server.
- **The database is the source of truth for stock.** `create_order()` locks
  inventory rows, reserves stock and recalculates every line total. A tampered
  client cannot oversell or change a price.
- **Payment and fulfilment are separate.** `payment_status` and
  `fulfilment_status` have independent values and timestamped history in
  `order_events`.
- **Payment is verified server-side.** No frontend action marks an order paid.
  Stripe webhooks are signature-verified before `mark_order_paid()` runs.
- **Nothing unpaid reaches a supplier.** Manual supplier submission requires
  `payment_status = 'paid'`, and the AW adapter has no automated submission.
- **Secrets stay on the server.** The service-role key, supplier token, Stripe
  secret and email key are never sent to the browser. Only `VITE_` variables are
  public, and they contain no secrets.
- **Guest orders use an unguessable access token.** Customers can retrieve their
  order and tracking without creating an account, without exposing order IDs.

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/setup.md](docs/setup.md) | Local setup, migrations, admin promotion, first run |
| [docs/architecture.md](docs/architecture.md) | Request flows, module map, order lifecycle, extension points |
| [docs/database.md](docs/database.md) | Tables, enums, functions, RLS matrix, maintenance |
| [docs/aw-dropship.md](docs/aw-dropship.md) | Supplier feasibility findings, sync behaviour, manual submission |
| [docs/security.md](docs/security.md) | Security controls, threat model, limits and pre-launch actions |
| [docs/deployment.md](docs/deployment.md) | Supabase and Vercel deployment, cron, webhook and smoke tests |
| [docs/testing.md](docs/testing.md) | Automated tests and manual QA checklist |
| [docs/handover.md](docs/handover.md) | Client inputs, launch blockers, operating runbook |

---

## Environment variables

`.env.example` is the canonical list. Never commit real values.

Public (safe in the browser):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_STORE_URL`
- `VITE_GA_MEASUREMENT_ID` (optional)
- `VITE_GOOGLE_SITE_VERIFICATION` (optional)

Server only:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_SITE_URL`
- `PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PAYMENT_METHOD_TYPES`
- `MANUAL_PAYMENT_INSTRUCTIONS`, `MANUAL_PAYMENT_ACCOUNT_NAME`,
  `MANUAL_PAYMENT_SORT_CODE`, `MANUAL_PAYMENT_ACCOUNT_NUMBER`
- `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `RESEND_API_KEY`
- `AW_DROPSHIP_API_TOKEN`, `AW_DROPSHIP_BASE_URL`,
  `AW_DROPSHIP_ORDER_SUBMISSION_ENABLED`, `AW_DROPSHIP_DEFAULT_CARRIER`,
  `AW_DROPSHIP_TIMEOUT_MS`
- `CRON_SECRET`, `RATE_LIMIT_SALT`

---

## Known limitations

- Automated AW Dropship order submission is deliberately disabled. The
  documented endpoints are known, but their request bodies are only available
  inside AW's authenticated documentation and have not been verified.
- Supplier live testing requires an AW account with API access, an active
  channel and a saved payment method or balance.
- Stripe eligibility for the client's business has not been confirmed. The code
  is real; the commercial account is not.
- The launch catalogue uses generated SVG artwork. Replace it with licensed
  product photography before launch.
- Shipping defaults to free with no invented delivery estimate. Configure real
  rates and estimates in Admin → Settings.
- Legal pages are implementation drafts and need review by the client or a
  qualified adviser.

These are launch tasks, not hidden simulations. Every placeholder or disabled
capability is labelled in the admin UI and in these documents.

---

## Ownership

This repository was built for Hasswell London. It is a private client project;
do not publish credentials, customer data or supplier pricing.
