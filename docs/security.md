# Security

This document describes the controls in the application, the threats they
address, and the work that must happen before a live launch. It is not a
certification or a penetration-test report.

## Security principles

1. **The browser is untrusted.** Prices, totals, stock, roles and payment state
   are always decided server-side.
2. **Least privilege.** Public pages use the Supabase anon key under RLS. The
   service role exists only in serverless functions.
3. **Secrets never cross the boundary.** Supplier tokens, Stripe secrets, email
   keys and the service-role key are server-only.
4. **Payment and fulfilment are verified, not assumed.** A frontend callback
   cannot mark an order paid or dispatched.
5. **Fail closed on money paths.** If the rate limiter, payment provider or
   amount check is unavailable, checkout refuses rather than guessing.
6. **Errors are safe.** Expected domain errors get clear messages; unexpected
   database and provider errors are logged server-side and returned generically.

## Secrets and configuration

### Public values

Only variables prefixed `VITE_` are bundled into the browser:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (public by design; protected by RLS)
- `VITE_STORE_URL`
- `VITE_GA_MEASUREMENT_ID` (optional)
- `VITE_GOOGLE_SITE_VERIFICATION` (optional)

### Server-only values

- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- `RESEND_API_KEY`.
- `AW_DROPSHIP_API_TOKEN`.
- `CRON_SECRET`, `RATE_LIMIT_SALT`.
- Manual bank details (not secret, but server-configured; never trusted from
  the browser).

Rules:

- Never put a server secret behind a `VITE_` name.
- Never commit `.env`; `.gitignore` excludes it.
- Use different Supabase projects and credentials for staging and production.
- Rotate any key that has appeared in a screenshot, chat, ticket or commit.
- Vercel environment variables should be scoped to Production/Preview as
  appropriate; do not expose production secrets to untrusted preview branches.

The database stores only the **name** of the supplier credential variable in
`supplier_accounts.credentials_ref`, never the token.

## Authentication and admin authorisation

- Supabase Auth handles passwords and sessions. The storefront uses PKCE.
- `profiles` mirrors `auth.users` through a trigger.
- Admin access requires `profiles.role = 'admin'` **and** `is_active = true`.
- Every `/api/admin/*` request calls `requireAdmin(req)`:
  1. reads the Bearer token;
  2. verifies it with Supabase Auth;
  3. loads the profile with the service role;
  4. rejects missing, inactive or non-admin profiles.
- The admin SPA also checks the profile, but only as a usability measure. The
  server check is authoritative.
- Customers cannot promote themselves: the update policy preserves the existing
  role and `update (role)` is revoked at column level.
- Admin sessions are normal Supabase sessions. Use a strong unique password and
  protect the email account; consider Supabase MFA for the owner account if the
  plan supports it.

### Admin promotion

`supabase/scripts/promote-admin.sql` is a one-off operator script. It contains
no credentials and is safe to keep in the repository, but it must only be run by
someone with database access. Review the admin list periodically:

```sql
select id, email, role, is_active from profiles where role = 'admin';
```

## Row-level security

RLS is enabled on all application tables. The full matrix is in
[database.md](database.md). Key properties:

- Anonymous users can read only active products, their images, categories,
  variants and the available-stock view.
- Customers can read only their own profile, customer record, orders, items and
  events.
- Payment transactions, inventory, supplier data, sync logs and private settings
  are admin-only.
- Newsletter and contact writes happen through server endpoints; there is no
  anonymous insert policy.
- The public `product_stock` view exposes available counts only.
- The service role bypasses RLS and is never returned to the browser.

RLS is a backstop, not the only control. Order creation still revalidates stock
and prices inside a transaction.

## Input validation and sanitisation

`api/_lib/validate.js` provides:

- email, UK postcode, country, phone and name validation;
- length limits and control-character stripping;
- multiline cleaning;
- boolean parsing;
- identifier and quantity validation;
- idempotency-key validation;
- checkout schema validation.

`api/_lib/http.js`:

- rejects wrong methods (`405`);
- requires `application/json` for JSON endpoints (`415`);
- enforces body-size limits (`413`);
- parses JSON safely (`400`);
- never includes stack traces in responses.

`api/_lib/supabase.js` translates known database errors into safe domain errors
and logs unexpected details without returning them.

Output encoding:

- The storefront escapes dynamic text before inserting it into HTML.
- Admin views use `escapeHtml()` for order, product and message data.
- Emails are built from templates with escaped values.
- The sitemap escapes XML.

## Rate limiting

Public write and lookup endpoints use a Postgres-backed counter so limits hold
across serverless instances:

| Endpoint | Limit |
| --- | --- |
| Checkout creation | 8 per 10 minutes, fail-closed |
| Payment retry | 10 per 10 minutes, fail-closed |
| Contact | 5 per hour |
| Newsletter | 5 per hour |
| Cart validation | 120 per minute |
| Order status | 120 per minute |
| Store config | 120 per minute |

The identifier is the client IP (first `x-forwarded-for` entry), hashed with
`RATE_LIMIT_SALT` before storage. Raw IP addresses are not stored. Counters older
than two days are pruned.

Limitations:

- Rate limiting is per IP, not per account. Shared networks can hit limits.
- A determined attacker with many IPs can still distribute requests.
- Admin endpoints rely on authentication rather than rate limiting; add an edge
  WAF if abuse is observed.

## Payments

### No card data

- Stripe Checkout collects card data on Stripe's domain.
- The application never receives, processes or stores card numbers, CVCs or
  expiry dates.
- This keeps the store in the simplest PCI DSS scope (SAQ A, subject to the
  acquirer's confirmation).

### Server-side verification

- No frontend action marks an order paid.
- Stripe webhooks are verified with HMAC-SHA256 over
  `${timestamp}.${rawBody}` and a 300-second tolerance.
- The raw body is read as bytes; a parsed object is not accepted for signature
  verification.
- Multiple `v1` signatures are supported for secret rotation.
- Only completed sessions with captured payment, or asynchronous payment
  success, can mark an order paid.
- The amount must cover the order total and the currency must match.
- A provider reference cannot be reused by a different order.
- Duplicate webhook delivery is idempotent: an already-paid order returns
  success without double-committing stock.
- A processing failure returns non-2xx so Stripe retries.

### Manual transfer

- The customer sees configured bank details and an order reference.
- Nothing is marked paid automatically.
- An administrator verifies the bank statement and records the reference.
- The verifying admin's email and timestamp are stored.

### Amount integrity

- Checkout recreates the Stripe session amount from the order.
- A mismatch between the provider amount and the order total aborts payment.
- Shipping is sent as its own line when non-zero, so no money is invented or
  lost.

### Refunds

Refunds are **not automated**. A refund must be handled in the provider
dashboard, then recorded in the admin order notes and status. Do not mark an
order refunded until the provider confirms it.

## Stock and fulfilment integrity

- `create_order()` locks inventory rows, checks available stock and reserves
  units in one transaction.
- The client cannot submit a price; any supplied price is ignored.
- `mark_order_paid()` commits reserved stock only after verified payment.
- `cancel_order()` restores stock according to whether payment was taken.
- Supplier sync cannot reduce on-hand stock below existing reservations.
- Every change writes an immutable `inventory_movements` row.
- `record_shipment()` requires payment and a tracking number, and refuses
  cancelled/failed orders. The admin form also requires a carrier.
- Unpaid orders cannot be submitted to a supplier.
- The AW connector has no automated submission, so an unverified payload cannot
  create a supplier order.

## Supplier security

- The AW token lives in an environment variable and is read server-side.
- `credentials_ref` must match `^[A-Z0-9_]+$`, so it can only name an environment
  variable.
- The admin supplier test is read-only and reports counts, not raw credentials.
- Supplier base URLs must use HTTPS.
- Supplier errors are logged with a truncated message; tokens are never logged.
- `supplier_sync_logs` stores counts and redacted errors, not credentials.

## Transport and browser headers

`vercel.json` sets:

- `Strict-Transport-Security` (HSTS, two years, include subdomains, preload);
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `Permissions-Policy` disabling camera, microphone and geolocation;
- long-lived immutable caching for `/assets`.

API responses set `Cache-Control: no-store` so order and admin data is not cached
by shared proxies.

### Content Security Policy

A CSP is **not currently configured**. Before launch, review the final third-party
scripts (analytics, Google verification) and add a CSP that allows only what is
needed. Test it in report-only mode first. Do not add `unsafe-inline` casually.

## Logging and personal data

- API errors log to the Vercel function log. Expected domain errors do not log
  stack traces; unexpected errors do.
- `email_log` stores recipient address, template, subject, status and a
  truncated error. It does not store full message bodies.
- `order_events` stores operational history and admin notes.
- Rate-limit identifiers are salted hashes.
- Supplier raw payloads may contain supplier data; they are admin-only under RLS.
- Do not paste customer data, tokens or full webhook bodies into tickets or chat.

Retention:

- Rate-limit rows: 2 days.
- Email log: 180 days.
- Orders and payment records: retain according to UK accounting and tax
  requirements; do not delete casually.
- Contact messages and newsletter records: define a retention policy with the
  client.

## Error handling

- Expected errors have a stable machine code and a user-safe message.
- Unexpected 5xx errors return a generic message.
- Database internals, stack traces, SQL and provider payloads are not returned.
- The Stripe webhook logs only safe summaries before rethrowing.
- The admin UI displays the server message and never assumes success locally.

## Known limitations and pre-launch actions

### Must do before taking real money

- [ ] Confirm the client's business and Stripe eligibility; complete Stripe
      onboarding and verification.
- [ ] Set live Stripe keys and the live webhook secret; register the production
      webhook endpoint.
- [ ] Verify the webhook end-to-end with a real low-value payment.
- [ ] Replace placeholder bank details and test the manual transfer flow if it
      remains enabled.
- [ ] Confirm refund, cancellation and chargeback procedures.
- [ ] Configure a verified email sending domain and test delivery.
- [ ] Review the legal pages (privacy, cookies, terms, delivery/returns) with the
      client or a qualified adviser.
- [ ] Add a cookie consent mechanism if analytics or marketing cookies are used.
- [ ] Add a CSP and re-test the storefront.
- [ ] Enable Supabase point-in-time recovery or scheduled backups.
- [ ] Rotate all development secrets and ensure no `.env` file is committed.
- [ ] Confirm the production `PUBLIC_SITE_URL` and canonical domain.
- [ ] Restrict admin accounts to named staff and enable MFA where available.
- [ ] Test the admin 401/403 paths and session expiry.

### Accepted or residual risks

- No CAPTCHA on contact/newsletter; rate limiting only.
- No automated fraud scoring; Stripe Radar settings depend on the Stripe account.
- No automated refunds or partial refunds.
- No supplier webhooks; status depends on polling.
- Stripe eligibility and AW API access are commercial dependencies, not code
  guarantees.
- The seeded catalogue and legal copy are placeholders until reviewed.
- A compromised admin account can perform all admin actions; protect it with a
  strong unique password and MFA.
- The application does not provide DDoS protection beyond the hosting platform.

## Incident checklist

1. Rotate the affected credential (Stripe, Supabase service role, supplier token,
   email key, cron secret).
2. Revoke the Supabase sessions of affected users if account compromise is
   suspected.
3. Disable the supplier account or payment provider in configuration if abuse is
   ongoing.
4. Preserve logs and database records; do not delete evidence.
5. Check `order_events`, `payment_transactions`, `inventory_movements` and
   `supplier_sync_logs` for unauthorised changes.
6. Notify the client and, where required, affected customers and regulators.
