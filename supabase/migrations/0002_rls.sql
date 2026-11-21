-- ===========================================================================
-- Hasswell London — Row Level Security
-- Migration 0002
--
-- Principles:
--  * Anonymous visitors may read the published catalogue only.
--  * Customers may read their own profile, customer record and orders.
--  * All writes that affect money, stock or fulfilment happen server-side with
--    the service role, or through admin-only policies.
--  * Nothing sensitive (payment transactions, supplier credentials, sync logs,
--    order internals) is readable by anonymous users.
-- ===========================================================================

-- Admin check is SECURITY DEFINER so policies do not recurse through profiles.
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active = true
  );
$$;

revoke all on function is_admin() from public;
grant execute on function is_admin() to anon, authenticated, service_role;

alter table profiles enable row level security;
alter table customers enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table product_images enable row level security;
alter table product_categories enable row level security;
alter table product_variants enable row level security;
alter table inventory enable row level security;
alter table inventory_movements enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_events enable row level security;
alter table payment_transactions enable row level security;
alter table supplier_accounts enable row level security;
alter table supplier_products enable row level security;
alter table supplier_orders enable row level security;
alter table supplier_sync_logs enable row level security;
alter table store_settings enable row level security;
alter table newsletter_subscribers enable row level security;
alter table contact_messages enable row level security;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_own_or_admin" on profiles;
create policy "profiles_select_own_or_admin" on profiles
  for select to authenticated
  using (id = auth.uid() or is_admin());

drop policy if exists "profiles_update_own_safe_fields" on profiles;
create policy "profiles_update_own_safe_fields" on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));

drop policy if exists "profiles_admin_all" on profiles;
create policy "profiles_admin_all" on profiles
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
drop policy if exists "customers_select_own_or_admin" on customers;
create policy "customers_select_own_or_admin" on customers
  for select to authenticated
  using (user_id = auth.uid() or is_admin());

drop policy if exists "customers_update_own" on customers;
create policy "customers_update_own" on customers
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "customers_admin_all" on customers;
create policy "customers_admin_all" on customers
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- Catalogue (public read of published records)
-- ---------------------------------------------------------------------------
drop policy if exists "categories_public_read" on categories;
create policy "categories_public_read" on categories
  for select to anon, authenticated
  using (is_active = true or is_admin());

drop policy if exists "categories_admin_write" on categories;
create policy "categories_admin_write" on categories
  for all to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "products_public_read" on products;
create policy "products_public_read" on products
  for select to anon, authenticated
  using (status = 'active' or is_admin());

drop policy if exists "products_admin_write" on products;
create policy "products_admin_write" on products
  for all to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "product_images_public_read" on product_images;
create policy "product_images_public_read" on product_images
  for select to anon, authenticated
  using (
    is_admin()
    or exists (
      select 1 from products p
      where p.id = product_images.product_id and p.status = 'active'
    )
  );

drop policy if exists "product_images_admin_write" on product_images;
create policy "product_images_admin_write" on product_images
  for all to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "product_categories_public_read" on product_categories;
create policy "product_categories_public_read" on product_categories
  for select to anon, authenticated
  using (
    is_admin()
    or exists (
      select 1 from products p
      where p.id = product_categories.product_id and p.status = 'active'
    )
  );

drop policy if exists "product_categories_admin_write" on product_categories;
create policy "product_categories_admin_write" on product_categories
  for all to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "product_variants_public_read" on product_variants;
create policy "product_variants_public_read" on product_variants
  for select to anon, authenticated
  using (
    is_admin()
    or (
      is_active = true
      and exists (
        select 1 from products p
        where p.id = product_variants.product_id and p.status = 'active'
      )
    )
  );

drop policy if exists "product_variants_admin_write" on product_variants;
create policy "product_variants_admin_write" on product_variants
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- Inventory (management data; storefront reads products.availability)
-- ---------------------------------------------------------------------------
drop policy if exists "inventory_admin_all" on inventory;
create policy "inventory_admin_all" on inventory
  for all to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "inventory_movements_admin_all" on inventory_movements;
create policy "inventory_movements_admin_all" on inventory_movements
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
drop policy if exists "orders_select_own_or_admin" on orders;
create policy "orders_select_own_or_admin" on orders
  for select to authenticated
  using (user_id = auth.uid() or is_admin());

drop policy if exists "orders_admin_update" on orders;
create policy "orders_admin_update" on orders
  for update to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "order_items_select_own_or_admin" on order_items;
create policy "order_items_select_own_or_admin" on order_items
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from orders o
      where o.id = order_items.order_id and o.user_id = auth.uid()
    )
  );

drop policy if exists "order_events_select_own_or_admin" on order_events;
create policy "order_events_select_own_or_admin" on order_events
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from orders o
      where o.id = order_events.order_id and o.user_id = auth.uid()
    )
  );

drop policy if exists "payment_transactions_admin_only" on payment_transactions;
create policy "payment_transactions_admin_only" on payment_transactions
  for select to authenticated
  using (is_admin());

-- ---------------------------------------------------------------------------
-- Supplier integration tables — admin only
-- ---------------------------------------------------------------------------
drop policy if exists "supplier_accounts_admin_all" on supplier_accounts;
create policy "supplier_accounts_admin_all" on supplier_accounts
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "supplier_products_admin_all" on supplier_products;
create policy "supplier_products_admin_all" on supplier_products
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "supplier_orders_admin_all" on supplier_orders;
create policy "supplier_orders_admin_all" on supplier_orders
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "supplier_sync_logs_admin_all" on supplier_sync_logs;
create policy "supplier_sync_logs_admin_all" on supplier_sync_logs
  for all to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Settings and inbound messages
-- ---------------------------------------------------------------------------
drop policy if exists "store_settings_public_read" on store_settings;
create policy "store_settings_public_read" on store_settings
  for select to anon, authenticated
  using (is_public = true or is_admin());

drop policy if exists "store_settings_admin_write" on store_settings;
create policy "store_settings_admin_write" on store_settings
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- Newsletter and contact form writes go through rate-limited server endpoints.
drop policy if exists "newsletter_admin_read" on newsletter_subscribers;
create policy "newsletter_admin_read" on newsletter_subscribers
  for select to authenticated using (is_admin());

drop policy if exists "contact_messages_admin_read" on contact_messages;
create policy "contact_messages_admin_read" on contact_messages
  for select to authenticated using (is_admin());

drop policy if exists "contact_messages_admin_update" on contact_messages;
create policy "contact_messages_admin_update" on contact_messages
  for update to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Column-level hardening: customers cannot grant themselves the admin role,
-- even through an otherwise valid update.
-- ---------------------------------------------------------------------------
revoke update (role) on profiles from authenticated;
