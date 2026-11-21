# Testing and quality assurance

## Automated tests

Run the suite with:

```bash
npm test
```

The tests use Node's built-in runner and make no network or database calls. They
cover pure logic that has caused real defects or protects money-sensitive paths.

| File | Covers |
| --- | --- |
| `tests/money.test.js` | Integer-pence parsing, rejection of invalid prices, formatting, percentage calculations |
| `tests/validate.test.js` | Cart identifiers/quantities, checkout schema, postcodes, countries, terms, contact/newsletter sanitisation |
| `tests/stripe-signature.test.js` | Valid HMAC, tampered payloads, wrong secret, malformed headers, tolerance window, multiple signatures |
| `tests/aw-mapper.test.js` | Feed wrapper keys, major/minor price conversion, SKU handling, duplicate collapse, status mapping, tracking extraction |
| `tests/settings-shipping.test.js` | Shipping defaults, flat rate, free threshold, region/currency normalisation, settings validation |

Current result: **24 tests passing**.

Run the production build as well:

```bash
npm run build
npm test
```

The build transforms every page and admin module; a missing import or syntax
error fails the build. The serverless functions are not bundled by Vite, so also
check their syntax when changing them:

```powershell
Get-ChildItem -Recurse -Filter *.js api,integrations |
  ForEach-Object { node --check $_.FullName }
```

```bash
find api integrations -name '*.js' -exec node --check {} \;
```

## What the automated tests do not cover

- Real Supabase queries, RLS policies or `SECURITY DEFINER` functions.
- Stripe API responses and real webhook delivery.
- AW Dropship responses.
- Browser rendering, accessibility or responsive layout.
- Email delivery.
- Vercel routing, cron or environment variables.

Those require the manual checks below, ideally against a staging project.

## Manual test plan

Use a staging Supabase project and test payment keys where possible. Do not use
real customer data.

### Storefront

- [ ] Home loads featured, best-seller and new-arrival sections from Supabase.
- [ ] Navigation, announcement bar and footer reflect `store_settings`.
- [ ] Shop page: search, category filter, sort, pagination/empty state.
- [ ] Product page: correct price, compare-at price, variants, stock status,
      image gallery, related products.
- [ ] A draft or archived product is not visible or reachable.
- [ ] Product structured data (JSON-LD) is valid and matches the page.
- [ ] Canonical URLs and Open Graph tags are present.
- [ ] Mobile drawer, search and cart count work.
- [ ] Keyboard navigation, focus visibility and skip link work.
- [ ] Reduced-motion preference is respected.

### Cart and checkout

- [ ] Add, update and remove lines; quantities clamp to available stock.
- [ ] Cart survives a page reload (localStorage identifiers only).
- [ ] Tampering with a stored price has no effect (prices are not stored).
- [ ] `/api/cart/validate` returns authoritative prices and issues.
- [ ] Out-of-stock or reduced-stock lines are flagged before checkout.
- [ ] Checkout rejects missing terms, invalid email/postcode/country.
- [ ] Unsupported shipping country is rejected.
- [ ] Submitting twice with the same `Idempotency-Key` returns one order.
- [ ] A payment initialisation failure leaves the order retrievable and does not
      tell the customer to pay twice.
- [ ] Confirmation page shows the correct total, payment status and instructions.
- [ ] Refreshing the confirmation page does not duplicate the order.
- [ ] An invalid or missing access token cannot read an order.

### Manual payment

- [ ] Checkout with `PAYMENT_PROVIDER=manual` shows real bank details and the
      order reference.
- [ ] Order status is `pending` / `pending_payment`.
- [ ] Admin **Mark paid** records the reference and verifying admin.
- [ ] Stock is committed once; sales count increases once.
- [ ] A second **Mark paid** is idempotent.
- [ ] An unpaid order cannot be manually submitted to the supplier.
- [ ] Cancelling an unpaid order releases the reservation.
- [ ] Cancelling a paid order returns committed stock.

### Stripe (test mode first)

- [ ] `PAYMENT_PROVIDER=stripe` with test keys creates a Checkout session.
- [ ] Session total equals the order total, including paid shipping.
- [ ] Session expires after one hour.
- [ ] Successful payment webhook marks the order paid exactly once.
- [ ] A tampered webhook body or wrong signature is rejected.
- [ ] An old signature is rejected.
- [ ] A duplicate webhook does not double-commit stock.
- [ ] An amount mismatch is rejected.
- [ ] Abandoned checkout leaves the order unpaid and retrievable.
- [ ] Retry payment creates a new session without creating a new order.

### Admin

- [ ] A signed-out user is redirected from `/admin`.
- [ ] A customer account receives 403 and cannot load data.
- [ ] An admin can load dashboard, products, orders, inventory, settings,
      supplier, messages, newsletter and email log.
- [ ] Product create/edit validates required fields and prices.
- [ ] Archiving a product removes it from the storefront.
- [ ] Image upload accepts only allowed image types and enforces size limits.
- [ ] Inventory adjustment cannot reduce stock below reservations.
- [ ] Every stock change appears in inventory movements.
- [ ] Order filters reject unknown status values.
- [ ] Order status cannot move to a fulfilment state before payment.
- [ ] "Dispatched" is only possible through **Confirm dispatch** with carrier
      and tracking.
- [ ] "Delivered" is blocked until tracking exists.
- [ ] Cancellation requires a reason and sends the cancellation path.
- [ ] Admin notes are not visible to customers.
- [ ] A 401/403 clears the admin session and returns to sign-in.

### Supplier

- [ ] Supplier test connection is read-only and reports a product count.
- [ ] Sync with no token fails with a clear, non-secret error.
- [ ] Sync imports supplier products and links exact SKUs.
- [ ] Unmatched products are created only as drafts when requested.
- [ ] Missing supplier stock is not applied as zero.
- [ ] Supplier stock cannot reduce on-hand below reservations.
- [ ] Sync logs record processed/failed counts and a redacted error.
- [ ] Polling a supplier order updates status and tracking when confirmed.
- [ ] Automated submission returns `SUPPLIER_ORDER_SUBMISSION_UNVERIFIED`.
- [ ] Manual submission requires payment and records the admin/reference.

### Email

- [ ] `EMAIL_PROVIDER=log` creates `logged` rows and sends nothing.
- [ ] `EMAIL_PROVIDER=resend` without a key fails safely and logs `failed`.
- [ ] Order received, payment confirmed, dispatch and cancellation emails render
      correctly and escape customer data.
- [ ] Email failure does not roll back an order or payment.
- [ ] Contact form notification is sent only when configured.

### Security and operations

- [ ] `/api/health` reports accurate capabilities without secrets.
- [ ] Rate limits trigger after the configured number of requests.
- [ ] Admin endpoints reject no token, expired token and customer token.
- [ ] Cron rejects a missing or wrong `CRON_SECRET`.
- [ ] Cron releases expired unpaid orders.
- [ ] Response headers include HSTS, nosniff, frame denial and referrer policy.
- [ ] No service-role key, Stripe secret, supplier token or email key appears in
      `dist/` or browser source.
- [ ] Unexpected API errors return a generic message, not SQL or a stack trace.
- [ ] `sitemap.xml` and `robots.txt` are correct on the production domain.

### Deployment

- [ ] Clean production build succeeds on Vercel.
- [ ] Clean URLs work for every page, including `/product/:slug` and `/admin`.
- [ ] Refresh on `/admin#/orders` works.
- [ ] Supabase auth redirects return to the correct domain.
- [ ] A real low-value live payment completes end-to-end.
- [ ] Backups are enabled and a restore has been tested.

## Useful manual checks

### Health

```bash
curl -s https://YOUR_DOMAIN/api/health | jq
```

### Cart validation contract

```bash
curl -s https://YOUR_DOMAIN/api/cart/validate \
  -H "Content-Type: application/json" \
  -d '{"items":[{"product_id":"PRODUCT_UUID","variant_id":null,"quantity":1}]}' | jq
```

Expected: `items`, `subtotal_minor`, `shipping_minor`, `total_minor`,
`currency`, `issues`, `removed_count`.

### Cron

```bash
curl -i https://YOUR_DOMAIN/api/cron/sync-supplier \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### Database spot checks

```sql
-- Reserved stock must never exceed on-hand stock
select * from inventory where stock_reserved > stock_on_hand;

-- Orders whose total does not match their lines and shipping
select o.order_number, o.total_minor,
       sum(i.line_total_minor) + o.shipping_minor - o.discount_minor as expected
from orders o
join order_items i on i.order_id = o.id
group by o.id
having o.total_minor <> sum(i.line_total_minor) + o.shipping_minor - o.discount_minor;

-- Paid orders with no payment transaction
select o.order_number
from orders o
left join payment_transactions t on t.order_id = o.id
where o.payment_status = 'paid' and t.id is null;

-- Dispatched orders without tracking
select order_number from orders
where status in ('dispatched', 'delivered') and tracking_number is null;
```

## Adding tests

- Keep tests pure: no network, no Supabase, no Vercel.
- Add a fixture for every supplier payload shape discovered during live testing.
- Add regression tests for every money, stock or signature bug.
- Do not weaken signature checks to make a test pass.
- For database logic, add SQL assertions or a staging integration test rather
  than mocking `create_order()`.
