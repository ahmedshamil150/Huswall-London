-- ===========================================================================
-- Hasswell London — Core schema
-- Migration 0001
--
-- Design rules:
--  * UUID primary keys, explicit foreign keys, unique constraints, timestamps.
--  * Internal IDs are never reused as supplier references.
--  * Money is stored as integer minor units (pence) to avoid float drift.
--  * Payment status and fulfilment status are independent columns.
--  * All stock changes are written to inventory_movements for audit.
-- ===========================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enumerated domains
-- ---------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('customer', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type product_status as enum ('draft', 'active', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type availability_status as enum ('in_stock', 'low_stock', 'out_of_stock', 'preorder', 'unavailable');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending', 'authorised', 'paid', 'failed', 'refunded', 'partially_refunded', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fulfilment_status as enum ('unfulfilled', 'awaiting_supplier', 'submitted_to_supplier', 'supplier_processing', 'dispatched', 'delivered', 'cancelled', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('pending_payment', 'paid', 'awaiting_supplier', 'submitted_to_supplier', 'supplier_processing', 'dispatched', 'delivered', 'cancelled', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type movement_reason as enum ('manual_adjustment', 'order_reserved', 'order_released', 'order_fulfilled', 'supplier_sync', 'import', 'return', 'correction');
exception when duplicate_object then null; end $$;

do $$ begin
  create type supplier_order_status as enum ('pending', 'submitted', 'processing', 'dispatched', 'delivered', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sync_status as enum ('running', 'success', 'partial', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Utility trigger
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (mirrors auth.users; role drives admin authorisation)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  phone       text,
  role        user_role not null default 'customer',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_role_idx on profiles (role) where role = 'admin';

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at before update on profiles
  for each row execute function set_updated_at();

-- Keep profiles in sync with Supabase Auth.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Customers (account holder or guest buyer; orders keep an address snapshot)
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid unique references auth.users (id) on delete set null,
  email             text not null,
  full_name         text,
  phone             text,
  accepts_marketing boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists customers_email_lower_uidx on customers (lower(email));

drop trigger if exists customers_set_updated_at on customers;
create trigger customers_set_updated_at before update on customers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references categories (id) on delete set null,
  name        text not null,
  slug        text not null unique,
  description text,
  image_url   text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists categories_active_idx on categories (is_active, sort_order);

drop trigger if exists categories_set_updated_at on categories;
create trigger categories_set_updated_at before update on categories
  for each row execute function set_updated_at();

create table if not exists products (
  id                      uuid primary key default gen_random_uuid(),
  sku                     text not null unique,
  slug                    text not null unique,
  name                    text not null,
  brand                   text not null default 'Hasswell London',
  short_description       text,
  description             text,
  price_minor             integer not null check (price_minor >= 0),
  compare_at_price_minor  integer check (compare_at_price_minor is null or compare_at_price_minor >= 0),
  currency                char(3) not null default 'GBP',
  status                  product_status not null default 'draft',
  availability            availability_status not null default 'out_of_stock',
  is_featured             boolean not null default false,
  is_best_seller          boolean not null default false,
  is_new_arrival          boolean not null default false,
  weight_grams            integer check (weight_grams is null or weight_grams > 0),
  meta_title              text,
  meta_description        text,
  sales_count             integer not null default 0,
  published_at            timestamptz,
  archived_at             timestamptz,
  search_text             text generated always as (
                            coalesce(name, '') || ' ' || coalesce(sku, '') || ' ' ||
                            coalesce(brand, '') || ' ' || coalesce(short_description, '')
                          ) stored,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint products_compare_price_check check (
    compare_at_price_minor is null or compare_at_price_minor >= price_minor
  )
);

create index if not exists products_status_idx on products (status, published_at desc);
create index if not exists products_featured_idx on products (is_featured) where status = 'active';
create index if not exists products_best_seller_idx on products (is_best_seller) where status = 'active';
create index if not exists products_new_arrival_idx on products (is_new_arrival) where status = 'active';
create index if not exists products_price_idx on products (price_minor);
create index if not exists products_search_trgm_idx on products using gin (search_text gin_trgm_ops);

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at before update on products
  for each row execute function set_updated_at();

create table if not exists product_images (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  url        text not null,
  alt        text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists product_images_product_idx on product_images (product_id, sort_order);
create unique index if not exists product_images_one_primary_uidx
  on product_images (product_id) where is_primary;

create table if not exists product_categories (
  product_id  uuid not null references products (id) on delete cascade,
  category_id uuid not null references categories (id) on delete cascade,
  primary key (product_id, category_id)
);

create index if not exists product_categories_category_idx on product_categories (category_id);

create table if not exists product_variants (
  id                     uuid primary key default gen_random_uuid(),
  product_id             uuid not null references products (id) on delete cascade,
  sku                    text not null unique,
  name                   text not null,
  options                jsonb not null default '{}'::jsonb,
  price_minor            integer not null check (price_minor >= 0),
  compare_at_price_minor integer check (compare_at_price_minor is null or compare_at_price_minor >= 0),
  availability           availability_status not null default 'out_of_stock',
  is_active              boolean not null default true,
  sort_order             integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists product_variants_product_idx on product_variants (product_id, sort_order);

drop trigger if exists variants_set_updated_at on product_variants;
create trigger variants_set_updated_at before update on product_variants
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------
create table if not exists inventory (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references products (id) on delete cascade,
  variant_id          uuid references product_variants (id) on delete cascade,
  stock_on_hand       integer not null default 0 check (stock_on_hand >= 0),
  stock_reserved      integer not null default 0 check (stock_reserved >= 0),
  low_stock_threshold integer not null default 3 check (low_stock_threshold >= 0),
  supplier_stock      integer check (supplier_stock is null or supplier_stock >= 0),
  last_synced_at      timestamptz,
  updated_at          timestamptz not null default now(),
  constraint inventory_reserved_within_stock check (stock_reserved <= stock_on_hand)
);

create unique index if not exists inventory_product_variant_uidx
  on inventory (product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists inventory_low_stock_idx
  on inventory ((stock_on_hand - stock_reserved)) where (stock_on_hand - stock_reserved) <= 5;

create table if not exists inventory_movements (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products (id) on delete cascade,
  variant_id        uuid references product_variants (id) on delete set null,
  delta_on_hand     integer not null default 0,
  delta_reserved    integer not null default 0,
  reason            movement_reason not null,
  reference_type    text,
  reference_id      uuid,
  note              text,
  actor             text not null default 'system',
  created_at        timestamptz not null default now()
);

create index if not exists inventory_movements_product_idx
  on inventory_movements (product_id, created_at desc);
create index if not exists inventory_movements_reference_idx
  on inventory_movements (reference_type, reference_id);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create sequence if not exists order_number_seq start 10001;

create or replace function generate_order_number()
returns text
language sql
volatile
as $$
  select 'HL-' || to_char(now(), 'YY') || '-' || lpad(nextval('order_number_seq')::text, 5, '0');
$$;

create table if not exists orders (
  id                 uuid primary key default gen_random_uuid(),
  order_number       text not null unique default generate_order_number(),
  user_id            uuid references auth.users (id) on delete set null,
  customer_id        uuid references customers (id) on delete set null,
  email              text not null,
  phone              text,
  shipping_name      text not null,
  shipping_line1     text not null,
  shipping_line2     text,
  shipping_city      text not null,
  shipping_region    text,
  shipping_postcode  text not null,
  shipping_country   char(2) not null default 'GB',
  delivery_notes     text,
  subtotal_minor     integer not null check (subtotal_minor >= 0),
  shipping_minor     integer not null default 0 check (shipping_minor >= 0),
  discount_minor     integer not null default 0 check (discount_minor >= 0),
  total_minor        integer not null check (total_minor >= 0),
  currency           char(3) not null default 'GBP',
  payment_status     payment_status not null default 'pending',
  fulfilment_status  fulfilment_status not null default 'unfulfilled',
  status             order_status not null default 'pending_payment',
  payment_provider   text,
  carrier            text,
  tracking_number    text,
  tracking_url       text,
  customer_notes     text,
  admin_notes        text,
  idempotency_key    text unique,
  access_token       uuid not null default gen_random_uuid(),
  placed_at          timestamptz not null default now(),
  paid_at            timestamptz,
  dispatched_at      timestamptz,
  delivered_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint orders_total_check check (total_minor = subtotal_minor + shipping_minor - discount_minor)
);

create index if not exists orders_status_idx on orders (status, placed_at desc);
create index if not exists orders_payment_status_idx on orders (payment_status, placed_at desc);
create index if not exists orders_customer_idx on orders (customer_id, placed_at desc);
create index if not exists orders_user_idx on orders (user_id, placed_at desc);
create index if not exists orders_email_idx on orders (lower(email));
create index if not exists orders_placed_at_idx on orders (placed_at desc);
create index if not exists orders_pending_payment_idx on orders (placed_at)
  where status = 'pending_payment';
create unique index if not exists orders_access_token_uidx on orders (access_token);

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at before update on orders
  for each row execute function set_updated_at();

create table if not exists order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders (id) on delete cascade,
  product_id       uuid references products (id) on delete set null,
  variant_id       uuid references product_variants (id) on delete set null,
  sku              text not null,
  name             text not null,
  variant_name     text,
  unit_price_minor integer not null check (unit_price_minor >= 0),
  quantity         integer not null check (quantity > 0 and quantity <= 99),
  line_total_minor integer not null check (line_total_minor >= 0),
  supplier_sku     text,
  created_at       timestamptz not null default now(),
  constraint order_items_line_total_check check (line_total_minor = unit_price_minor * quantity)
);

create index if not exists order_items_order_idx on order_items (order_id);
create index if not exists order_items_product_idx on order_items (product_id);

create table if not exists order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders (id) on delete cascade,
  event_type  text not null,
  from_status text,
  to_status   text,
  message     text,
  actor       text not null default 'system',
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists order_events_order_idx on order_events (order_id, created_at);

create table if not exists payment_transactions (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders (id) on delete cascade,
  provider           text not null,
  provider_reference text not null,
  amount_minor       integer not null check (amount_minor >= 0),
  currency           char(3) not null default 'GBP',
  status             text not null default 'pending',
  failure_reason     text,
  raw_payload        jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (provider, provider_reference)
);

create index if not exists payment_transactions_order_idx on payment_transactions (order_id, created_at desc);

drop trigger if exists payment_transactions_set_updated_at on payment_transactions;
create trigger payment_transactions_set_updated_at before update on payment_transactions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Supplier integration
-- ---------------------------------------------------------------------------
create table if not exists supplier_accounts (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,
  connector      text not null,
  is_active      boolean not null default false,
  api_base_url   text,
  credentials_ref text,
  config         jsonb not null default '{}'::jsonb,
  capabilities   jsonb not null default '{}'::jsonb,
  notes          text,
  last_sync_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists supplier_accounts_set_updated_at on supplier_accounts;
create trigger supplier_accounts_set_updated_at before update on supplier_accounts
  for each row execute function set_updated_at();

create table if not exists supplier_products (
  id                  uuid primary key default gen_random_uuid(),
  supplier_id         uuid not null references supplier_accounts (id) on delete cascade,
  product_id          uuid references products (id) on delete set null,
  variant_id          uuid references product_variants (id) on delete set null,
  supplier_product_id text,
  supplier_sku        text not null,
  supplier_price_minor integer,
  supplier_rrp_minor  integer,
  supplier_stock      integer,
  supplier_availability text,
  is_active           boolean not null default true,
  raw_payload         jsonb not null default '{}'::jsonb,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (supplier_id, supplier_sku)
);

create index if not exists supplier_products_product_idx on supplier_products (product_id);
create index if not exists supplier_products_supplier_idx on supplier_products (supplier_id, last_synced_at desc);

drop trigger if exists supplier_products_set_updated_at on supplier_products;
create trigger supplier_products_set_updated_at before update on supplier_products
  for each row execute function set_updated_at();

create table if not exists supplier_orders (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders (id) on delete cascade,
  supplier_id       uuid not null references supplier_accounts (id) on delete restrict,
  external_reference text not null,
  external_order_id text,
  status            supplier_order_status not null default 'pending',
  idempotency_key   text not null unique,
  external_client_id text,
  attempts          integer not null default 0,
  last_error         text,
  carrier           text,
  tracking_number   text,
  tracking_url      text,
  raw_payload       jsonb not null default '{}'::jsonb,
  submitted_at      timestamptz,
  dispatched_at     timestamptz,
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (supplier_id, external_reference)
);

create index if not exists supplier_orders_order_idx on supplier_orders (order_id);
create index if not exists supplier_orders_status_idx on supplier_orders (status, created_at desc);

drop trigger if exists supplier_orders_set_updated_at on supplier_orders;
create trigger supplier_orders_set_updated_at before update on supplier_orders
  for each row execute function set_updated_at();

create table if not exists supplier_sync_logs (
  id                uuid primary key default gen_random_uuid(),
  supplier_id       uuid references supplier_accounts (id) on delete cascade,
  job_type          text not null,
  status            sync_status not null default 'running',
  records_processed integer not null default 0,
  records_failed    integer not null default 0,
  error_message     text,
  metadata          jsonb not null default '{}'::jsonb,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz
);

create index if not exists supplier_sync_logs_supplier_idx
  on supplier_sync_logs (supplier_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Store settings, marketing, support
-- ---------------------------------------------------------------------------
create table if not exists store_settings (
  key        text primary key,
  value      jsonb not null,
  is_public  boolean not null default false,
  updated_at timestamptz not null default now()
);

drop trigger if exists store_settings_set_updated_at on store_settings;
create trigger store_settings_set_updated_at before update on store_settings
  for each row execute function set_updated_at();

create table if not exists newsletter_subscribers (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  source      text not null default 'website',
  confirmed   boolean not null default false,
  created_at  timestamptz not null default now()
);

create unique index if not exists newsletter_email_uidx on newsletter_subscribers (lower(email));

create table if not exists contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  subject    text,
  message    text not null,
  status     text not null default 'new',
  created_at timestamptz not null default now()
);

create index if not exists contact_messages_status_idx on contact_messages (status, created_at desc);
