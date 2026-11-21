# Handover and launch

This document is the practical handover for the Hasswell London store. It lists
what the client must provide, what must be true before launch, and how to run the
store afterwards.

## What is included

A custom storefront, admin panel, Supabase schema and serverless API, with:

- catalogue, search, categories, variants, stock and product imagery;
- cart, checkout, order confirmation, guest order lookup and customer accounts;
- manual bank transfer and a real Stripe Checkout adapter;
- server-verified payments and separate fulfilment state;
- transactional email with a log mode and a Resend adapter;
- AW Dropship catalogue/stock sync and status polling;
- manual supplier submission recording (automated submission is not enabled);
- inventory movements, order events and email audit logs;
- admin dashboard, products, orders, inventory, settings, supplier, messages,
  newsletter and email log;
- SEO, sitemap, robots, Open Graph and JSON-LD;
- RLS, validation, rate limiting and security headers.

## What the client must provide

Do not send secrets in plain email or chat. Use a password manager or a secure
handover channel.

### Commercial and account details

- [ ] Final domain and DNS access.
- [ ] Company legal name, company number and VAT number (if applicable).
- [ ] Registered business address and customer-service contact details.
- [ ] Bank account name, sort code and account number for manual transfers
      (only if manual payment will be used).
- [ ] Stripe account access and confirmation that the business is eligible.
- [ ] AW Dropship account, API token, active channel, and confirmation that the
      plan includes API access.
- [ ] Confirmation of who is authorised to submit supplier orders and mark
      payments received.

### Content

- [ ] Final product list with SKUs, titles, descriptions, prices, compare-at
      prices (if any), variants and stock.
- [ ] Licensed product photography, alt text and usage rights.
- [ ] Category structure and navigation labels.
- [ ] Shipping rates, free-shipping threshold and delivery estimate. (The
      platform ships with £0 and no invented estimate.)
- [ ] Returns window, returns process and address.
- [ ] About, contact, FAQ, privacy, cookie and terms copy approved by the client
      or a qualified adviser.
- [ ] Social links, announcement text and brand assets.
- [ ] Analytics/consent requirements, if any.

### Operational

- [ ] Who monitors orders and how often.
- [ ] Who reconciles manual bank transfers.
- [ ] Who submits orders to AW and records references.
- [ ] Who handles customer service, cancellations and refunds.
- [ ] Escalation contact for payment or supplier incidents.
- [ ] Email sender domain and DNS access for verification.

## Launch blockers

These are not optional polish. Do not take real orders until they are resolved.

| Blocker | Why |
| --- | --- |
| Payment provider not configured or not verified | Checkout fails closed; no money can be taken |
| Bank details or Stripe onboarding incomplete | Customers cannot pay |
| Real shipping rates and estimate not set | The store would promise free/unknown delivery |
| Catalogue still on placeholder artwork or copy | Not launch-ready |
| Legal pages not reviewed | Consumer-law and privacy exposure |
| Admin owner not promoted/secured | No one can operate the store safely |
| `PUBLIC_SITE_URL` / `VITE_STORE_URL` not the live domain | Wrong canonical links and payment redirects |
| Email sender not verified | Customers receive no confirmations |
| Backups not enabled | No recovery path |
| Automated AW submission assumed to work | It does not; orders must be submitted manually |
| Supplier API access not confirmed | Sync/polling cannot run |

## Known gaps

| Gap | Current behaviour | Next step |
| --- | --- | --- |
| AW automated order submission | Refuses with `SUPPLIER_ORDER_SUBMISSION_UNVERIFIED` | Obtain authenticated docs, verify in staging, implement and test |
| AW webhooks | None available | Keep polling and manual checks |
| Refunds | Not automated | Process in provider dashboard, record in admin |
| Stripe eligibility | Commercial dependency | Client completes onboarding |
| Live supplier testing | Not performed | Use client's token and a test order |
| Real email delivery | Default is `log` | Verify domain and set `EMAIL_PROVIDER=resend` |
| Product photography | Seeded SVG artwork | Replace with licensed images |
| Cookie consent | Not implemented | Add if analytics/marketing cookies are used |
| CSP | Not configured | Add and test before launch |
| Multi-admin roles | One admin role | Add finer permissions only if needed |
| Multi-currency | GBP only | Requires schema, pricing and payment review |
| Automated fraud screening | Provider defaults | Configure Stripe Radar or manual rules |

## First-week operating routine

### Daily

1. Open Admin → Dashboard.
2. Check **pending payment** orders and reconcile bank transfers.
3. For each paid order, submit manually in AW and record the reference in the
   order.
4. Poll supplier status or wait for the cron sync.
5. Confirm dispatch only when AW provides a carrier and tracking number.
6. Check low-stock and out-of-stock alerts.
7. Review Admin → Email log for `failed` rows.
8. Answer customer messages and order enquiries.

### Weekly

1. Review unpaid orders older than 24 hours (the cron cancels them and releases
   stock).
2. Reconcile payments in the provider dashboard against paid orders.
3. Review supplier sync logs for failures or unexpected stock changes.
4. Check for products with missing imagery or copy.
5. Review contact messages and newsletter signups.
6. Confirm backups are running.

### Monthly

1. Review admin accounts and remove leavers.
2. Rotate credentials only on a planned schedule or after an incident.
3. Update dependencies and run `npm test` and `npm run build`.
4. Re-verify the supplier integration after any AW account or plan change.
5. Review privacy/retention obligations.
6. Test a restore on staging.

## Manual supplier workflow

Automated submission is disabled. For every paid order:

1. Confirm `payment_status = paid` in Admin → Orders.
2. Open AW Dropship.
3. Create the order with the exact delivery address and items.
4. Copy the AW order reference.
5. In Admin → Orders → supplier section, enter the reference and choose
   **Record manual submission**.
6. The order moves to `submitted_to_supplier`.
7. Use **Poll status** to retrieve processing/dispatch updates.
8. When AW confirms dispatch with tracking, record the shipment (or let polling
   do it) and the customer receives the dispatch path.
9. Never tell a customer an order is dispatched before tracking is confirmed.

## Payment reconciliation

### Manual transfer

1. Match the incoming amount and payment reference to the order.
2. Open the order in admin.
3. Enter the bank reference and choose **Mark paid**.
4. Confirm stock committed and the confirmation email is recorded.
5. If the amount is wrong or the reference is missing, contact the customer
   before marking paid.

### Stripe

1. Stripe webhooks update paid status automatically after a verified payment.
2. If a payment is visible in Stripe but the order is still pending:
   - check the webhook endpoint and signing secret;
   - check Vercel logs for `[stripe]`;
   - verify the event type and amount;
   - do not mark paid manually without checking the Stripe payment first.
3. Refunds are handled in Stripe, then recorded in the order timeline.

## Stock rules for staff

- Never edit `stock_on_hand` directly in the database.
- Use Admin → Inventory so a movement is recorded.
- Stock cannot be reduced below reserved units; cancel or fulfil orders first.
- Supplier sync updates supplier stock but respects reservations.
- If physical stock differs, adjust with a note explaining why.
- Use `inventory_movements` to investigate discrepancies.

## Content updates

- Products, categories, prices, stock and imagery are managed in `/admin`.
- Public settings such as store name, email, shipping and announcement are in
  Admin → Settings.
- Product images are stored in the public `product-images` bucket and referenced
  by URL. Keep alt text meaningful.
- Archived products disappear from the storefront but remain in order history.
- The seeded catalogue is a starting point, not final content.

## Access and credentials

- The client owns the Supabase, Vercel, Stripe, Resend and AW accounts.
- Use a shared password manager for handover.
- Each administrator should have their own Supabase Auth account and profile.
- Do not share the service-role key with staff; it is only for the Vercel
  environment.
- Store recovery codes securely.
- Remove access promptly when a staff member leaves.

## Support boundaries

This handover covers the code and configuration in this repository. It does not
include:

- AW Dropship account approval or commercial terms;
- Stripe underwriting or eligibility;
- legal review of policies;
- product photography or copywriting;
- ongoing content entry;
- payment disputes or chargebacks;
- third-party outage compensation.

Any future automated supplier submission work requires the authenticated AW API
documentation and a verified staging test. It should be quoted and scheduled
separately.

## Acceptance criteria

The build is ready for launch when:

- [ ] `npm test` passes and `npm run build` succeeds.
- [ ] Production `/api/health` reports `ok`.
- [ ] A real low-value payment succeeds and marks the order paid once.
- [ ] Stock reserves, commits and releases correctly in all three paths.
- [ ] A customer can retrieve an order with the access token.
- [ ] An admin can operate products, orders and inventory without database
      access.
- [ ] A supplier order can be recorded manually and tracking can be recorded.
- [ ] Email delivery is verified or the client accepts log-only mode.
- [ ] Legal, shipping and returns content is approved.
- [ ] Backups and admin access are in place.
- [ ] The client understands that AW submission is manual.

## Contact and escalation

Record the following in the client's operations document:

| Role | Name | Contact |
| --- | --- | --- |
| Store owner | | |
| Payment reconciliation | | |
| Supplier ordering | | |
| Customer service | | |
| Technical support | | |
| Hosting/database owner | | |

Keep this document with the client's operational records, not in a public
repository.
