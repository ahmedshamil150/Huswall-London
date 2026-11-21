# Database

The database is the authority for catalogue visibility, prices, stock, orders
and payments. The storefront reads through RLS; the server writes through
`SECURITY DEFINER` functions executed by the service role.

## Migrations

Run in numeric order on a new project:

| File | Contents |
| --- | --- |
| `0001_schema.sql` | Extensions, enums, tables, indexes, triggers |
| `0002_rls.sql` | RLS enablement, policies, `is_admin()`, column hardening |
| `0003_functions.sql` | Order, payment, stock, shipment and dashboard functions |
| `0004_seed.sql` | Launch catalogue, categories, settings, inactive supplier |
| `0005_storage.sql` | Public `product-images` bucket and storage policies |
| `0006_stock_view.sql` | `product_stock` public availability view |
| `0007_operations.sql` | Rate limits, email log, pruning function |

All domain functions are created with `security definer`,
`set search_path = public, pg_temp`, and explicit `revoke`/`grant` statements.
Only `service_role` may execute the money and stock functions.

## Enumerated types

| Type | Values |
| --- | --- |
| `user_role` | `customer`, `admin` |
| `product_status` | `draft`, `active`, `archived` |
| `availability_status` | `in_stock`, `low_stock`, `out_of_stock`, `preorder`, `unavailable` |
| `payment_status` | `pending`, `authorised`, `paid`, `failed`, `refunded`, `partially_refunded`, `cancelled` |
| `fulfilment_status` | `unfulfilled`, `awaiting_supplier`, `submitted_to_supplier`, `supplier_processing`, `dispatched`, `delivered`, `cancelled`, `failed` |
| `order_status` | `pending_payment`, `paid`, `awaiting_supplier`, `submitted_to_supplier`, `supplier_processing`, `dispatched`, `delivered`, `cancelled`, `failed` |
| `movement_reason` | `manual_adjustment`, `order_reserved`, `order_released`, `order_fulfilled`, `supplier_sync`, `import`, `return`, `correction` |
| `supplier_order_status` | `pending`, `submitted`, `processing`, `dispatched`, `delivered`, `failed`, `cancelled` |
| `sync_status` | `running`, `success`, `partial`, `failed` |

Payment and fulfilment are independent. An order can be paid but not yet
submitted to a supplier, and an order is never marked dispatched without
tracking.

## Tables

### Identity and customers

| Table | Purpose | Key rules |
| --- | --- | --- |
| `profiles` | One row per Supabase Auth user | `role` drives admin access; customers cannot update `role` |
| `customers` | Buyer record for account holders and guests | Unique lowercase email; linked to `auth.users` when signed in |

`handle_new_user()` creates a profile automatically after signup. The
`set_updated_at()` trigger maintains `updated_at`.

### Catalogue

| Table | Purpose | Key rules |
| --- | --- | --- |
| `categories` | Navigation and grouping | Unique slug; `is_active` controls public visibility |
| `products` | Sellable product | Unique `sku` and `slug`; money in integer pence; `status = 'active'` required for public reads |
| `product_images` | Ordered imagery | At most one `is_primary` per product |
| `product_categories` | Many-to-many | Composite primary key |
| `product_variants` | Size/option variants | Unique SKU; own price and availability |
| `inventory` | Stock per product or variant | `stock_on_hand`, `stock_reserved`, low-stock threshold, supplier stock |
| `inventory_movements` | Immutable stock audit | Every reservation, release, commit, adjustment and sync |

Important constraints:

- `price_minor >= 0`, `compare_at_price_minor >= price_minor` when present.
- `stock_reserved <= stock_on_hand` at all times.
- One inventory row per `(product_id, variant_id)`; a null variant is normalised
  with a sentinel UUID in the unique index.
- Product search uses a generated `search_text` column with a trigram index.

### Orders and payments

| Table | Purpose | Key rules |
| --- | --- | --- |
| `orders` | Order header and address snapshot | Unique order number and access token; unique idempotency key; total check constraint |
| `order_items` | Immutable line snapshot | `line_total_minor = unit_price_minor * quantity`; quantity 1–99 |
| `order_events` | Timestamped status history | Payment, fulfilment, admin notes and failures |
| `payment_transactions` | Provider references and amounts | Unique `(provider, provider_reference)` |

The order number format is `HL-YY-NNNNN`, generated from a sequence. The
customer-facing order lookup requires both the order number and the UUID
`access_token`; internal IDs are not exposed as access credentials.

`orders` stores the delivery address as a snapshot. Changing a customer record
later does not rewrite historical orders.

### Supplier integration

| Table | Purpose |
| --- | --- |
| `supplier_accounts` | Connector configuration and capabilities; stores an env var name in `credentials_ref`, never a token |
| `supplier_products` | Supplier SKU catalogue, linked to internal products/variants |
| `supplier_orders` | Manual or automated submission records, external references and polling state |
| `supplier_sync_logs` | Job type, status, processed/failed counts and redacted errors |

### Settings and operations

| Table | Purpose |
| --- | --- |
| `store_settings` | JSON values with an `is_public` flag |
| `newsletter_subscribers` | Email signups; admin-readable only |
| `contact_messages` | Contact form submissions; admin-readable only |
| `rate_limits` | Database-backed counters for serverless rate limiting |
| `email_log` | Transactional email audit trail (`logged`, `sent`, `failed`) |

The `product_stock` view exposes only:

```text
id, product_id, variant_id, available, updated_at
```

where `available = max(stock_on_hand - stock_reserved, 0)`. It never exposes
cost, supplier references or reservation detail. Enforcement remains inside
`create_order()`.

## Domain functions

### Order lifecycle

| Function | Caller | Behaviour |
| --- | --- | --- |
| `create_order(items, customer, shipping, user, idempotency, notes…)` | `service_role` | Validates customer, locks stock, recalculates prices, reserves units, writes order/items/events. Returns order number and access token. Replays an existing idempotency key. |
| `mark_order_paid(order, provider, reference, amount, currency, raw)` | `service_role` | Verifies amount/currency/reference uniqueness, commits reserved stock, increments sales, sets `awaiting_supplier`, records payment and event. Idempotent for an already-paid order. |
| `cancel_order(order, reason, actor)` | `service_role` | Releases reservations or restores committed stock, sets cancelled, records reason. Refuses dispatched/delivered orders. |
| `admin_update_order_status(order, status, note, actor)` | `service_role` | Moves fulfilment/order status; requires payment before paid/fulfilment states; protects cancelled and delivered terminal states. |
| `record_shipment(order, carrier, tracking, url, actor)` | `service_role` | Requires paid, not cancelled/failed, and a non-empty tracking number; sets dispatched and records tracking. Idempotent for delivered. |
| `release_expired_orders(hours)` | `service_role` | Cancels unpaid orders past the reservation window and releases stock. |

### Stock and supplier

| Function | Behaviour |
| --- | --- |
| `refresh_product_availability(product)` | Derives product/variant availability from available stock and low-stock thresholds |
| `admin_adjust_stock(product, variant, delta, note, actor)` | Adjusts on-hand stock, refuses to fall below reserved, writes a movement |
| `apply_supplier_stock_batch(supplier, rows)` | Applies supplier stock per SKU; never drops below reserved units; writes movements |

### Operations and reporting

| Function | Behaviour |
| --- | --- |
| `consume_rate_limit(key, limit, window)` | Atomic counter window for serverless rate limiting |
| `prune_operational_tables()` | Deletes rate-limit rows older than 2 days and email log rows older than 180 days |
| `admin_dashboard_stats()` | Aggregates orders, revenue, stock alerts, recent orders and best sellers |
| `is_admin()` | `SECURITY DEFINER` boolean used by RLS policies |

## Row-level security

RLS is enabled on every application table.

| Data | Anonymous | Authenticated customer | Admin |
| --- | --- | --- | --- |
| Active products, images, categories, variants | Read | Read | Full |
| Draft/archived products | No | No | Full |
| Product stock view | Read available count | Read available count | Read available count |
| Own profile | No | Read; update safe fields | Full |
| Other profiles | No | No | Read |
| Own customer record and orders | No | Read/update own customer row; read own orders/items/events | Full |
| Payment transactions | No | No | Read |
| Inventory and movements | No | No | Full |
| Supplier tables | No | No | Full |
| Public store settings | Read | Read | Full |
| Private store settings | No | No | Full |
| Newsletter and contact messages | No direct access (server endpoints) | No | Read/update |
| Email log | No | No | Read |

`is_admin()` checks `profiles.role = 'admin'` and `is_active = true`. It is
`SECURITY DEFINER` to avoid recursive policy evaluation.

Customers cannot promote themselves:

- the profile update policy requires the role to remain unchanged;
- `update (role)` is revoked from `authenticated` at column level.

The service role bypasses RLS. It is used only inside serverless functions.

## Money and rounding

- Every monetary column is an integer count of minor units (pence).
- Prices are recalculated from `products`/`product_variants` inside
  `create_order()`; client-supplied prices are ignored.
- Order totals are protected by a check constraint:
  `total_minor = subtotal_minor + shipping_minor - discount_minor`.
- Line totals are protected by:
  `line_total_minor = unit_price_minor * quantity`.
- Formatting happens only at the edge (`shared/js/money.js`,
  `api/_lib/email-templates.js`).

## Stock rules

1. **Reserve on order creation.** `stock_reserved` increases; `stock_on_hand`
   is unchanged.
2. **Commit on verified payment.** Both `stock_on_hand` and `stock_reserved`
   decrease, and `sales_count` increases.
3. **Release on cancellation or expiry.** If unpaid, only the reservation is
   released. If paid, the committed quantity is returned to on-hand stock.
4. **Never trust the client.** Available stock is rechecked under a row lock at
   order creation. A stale page cannot oversell.
5. **Audit everything.** Each change writes `inventory_movements` with a reason,
   reference and actor.

Supplier sync applies stock with
`stock_on_hand = greatest(supplier_stock, stock_reserved)`. Existing
reservations are never invalidated by a supplier feed.

## Admin role management

Promote a user with `supabase/scripts/promote-admin.sql`:

```sql
update profiles
set role = 'admin', is_active = true, updated_at = now()
where lower(email) = lower('owner@example.com');
```

Demote by setting `role = 'customer'` or `is_active = false`. The user's existing
session remains valid for authentication, but every admin API call re-checks the
profile and will return 403.

## Backup and maintenance

- Enable Supabase point-in-time recovery on a paid plan for production. On
  smaller plans, schedule regular logical backups.
- `release_expired_orders(24)` and `prune_operational_tables()` run from the
  cron endpoint.
- `email_log` retains 180 days; adjust in `prune_operational_tables()` if the
  client's retention policy requires a different period.
- Review `inventory_movements` when investigating stock discrepancies.
- Do not edit `orders`, `order_items` or `payment_transactions` manually unless
  correcting a known incident, and record the reason in `order_events`.

## Useful queries

```sql
-- Orders waiting for payment
select order_number, email, total_minor, placed_at
from orders
where status = 'pending_payment'
order by placed_at;

-- Paid but not yet sent to the supplier
select order_number, email, total_minor, paid_at
from orders
where payment_status = 'paid'
  and status in ('paid', 'awaiting_supplier')
order by paid_at;

-- Low stock
select p.name, p.sku, i.stock_on_hand, i.stock_reserved,
       i.stock_on_hand - i.stock_reserved as available
from inventory i
join products p on p.id = i.product_id
where i.stock_on_hand - i.stock_reserved <= i.low_stock_threshold
order by available;

-- Recent stock movements for one product
select created_at, reason, delta_on_hand, delta_reserved, note, actor
from inventory_movements
where product_id = 'PRODUCT_UUID'
order by created_at desc
limit 50;
```
