-- ===========================================================================
-- Hasswell London — Domain functions
-- Migration 0003
--
-- These functions are the only path through which orders, payments and stock
-- change. They run as SECURITY DEFINER and are executed by the server (service
-- role) — never by the browser.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Availability derivation
-- ---------------------------------------------------------------------------
create or replace function refresh_product_availability(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_variant record;
  v_inv record;
  v_has_variants boolean;
  v_best availability_status := 'out_of_stock';
  v_status availability_status;
begin
  select exists (
    select 1 from product_variants
    where product_id = p_product_id and is_active = true
  ) into v_has_variants;

  if v_has_variants then
    for v_variant in
      select * from product_variants
      where product_id = p_product_id and is_active = true
    loop
      select * into v_inv from inventory
      where product_id = p_product_id and variant_id = v_variant.id;

      if v_inv.id is null or (v_inv.stock_on_hand - v_inv.stock_reserved) <= 0 then
        v_status := 'out_of_stock';
      elsif (v_inv.stock_on_hand - v_inv.stock_reserved) <= v_inv.low_stock_threshold then
        v_status := 'low_stock';
      else
        v_status := 'in_stock';
      end if;

      update product_variants set availability = v_status where id = v_variant.id;

      if v_status = 'in_stock' then
        v_best := 'in_stock';
      elsif v_status = 'low_stock' and v_best <> 'in_stock' then
        v_best := 'low_stock';
      end if;
    end loop;
  else
    select * into v_inv from inventory
    where product_id = p_product_id and variant_id is null;

    if v_inv.id is null or (v_inv.stock_on_hand - v_inv.stock_reserved) <= 0 then
      v_best := 'out_of_stock';
    elsif (v_inv.stock_on_hand - v_inv.stock_reserved) <= v_inv.low_stock_threshold then
      v_best := 'low_stock';
    else
      v_best := 'in_stock';
    end if;
  end if;

  update products
  set availability = v_best
  where id = p_product_id
    and status <> 'archived'
    and availability <> v_best;

  -- Archived/unavailable products keep their explicit 'unavailable' marker.
end;
$$;

-- ---------------------------------------------------------------------------
-- create_order — validates catalogue, prices and stock in one transaction
-- ---------------------------------------------------------------------------
create or replace function create_order(
  p_items jsonb,
  p_customer jsonb,
  p_shipping_minor integer default 0,
  p_user_id uuid default null,
  p_idempotency_key text default null,
  p_customer_notes text default null,
  p_delivery_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing orders;
  v_order orders;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_row record;
  v_product products;
  v_variant product_variants;
  v_inv inventory;
  v_quantity integer;
  v_available integer;
  v_unit_price integer;
  v_subtotal integer := 0;
  v_total integer;
  v_shipping integer := greatest(coalesce(p_shipping_minor, 0), 0);
  v_email text := lower(trim(coalesce(p_customer ->> 'email', '')));
  v_name text := trim(coalesce(p_customer ->> 'shipping_name', ''));
  v_customer_id uuid;
  v_user_id uuid := p_user_id;
  v_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'CART_EMPTY' using errcode = 'P0001';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;

  if v_name = '' then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;

  if trim(coalesce(p_customer ->> 'shipping_line1', '')) = ''
     or trim(coalesce(p_customer ->> 'shipping_city', '')) = ''
     or trim(coalesce(p_customer ->> 'shipping_postcode', '')) = '' then
    raise exception 'INVALID_ADDRESS' using errcode = 'P0001';
  end if;

  -- Idempotency: a repeated submit returns the original order untouched.
  if p_idempotency_key is not null then
    select * into v_existing from orders where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'id', v_existing.id,
        'order_number', v_existing.order_number,
        'access_token', v_existing.access_token,
        'subtotal_minor', v_existing.subtotal_minor,
        'shipping_minor', v_existing.shipping_minor,
        'total_minor', v_existing.total_minor,
        'currency', v_existing.currency,
        'status', v_existing.status,
        'payment_status', v_existing.payment_status,
        'idempotent_replay', true
      );
    end if;
  end if;

  -- Aggregate duplicate lines defensively.
  for v_row in
    select
      (item ->> 'product_id')::uuid as product_id,
      nullif(item ->> 'variant_id', '')::uuid as variant_id,
      sum((item ->> 'quantity')::integer) as quantity
    from jsonb_array_elements(p_items) as item
    group by 1, 2
    order by 1, 2
  loop
    if v_row.quantity is null or v_row.quantity < 1 or v_row.quantity > 99 then
      raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
    end if;
    v_quantity := v_row.quantity;

    select * into v_product from products where id = v_row.product_id;
    if not found or v_product.status <> 'active' then
      raise exception 'PRODUCT_UNAVAILABLE:%', v_row.product_id using errcode = 'P0001';
    end if;

    if v_row.variant_id is not null then
      select * into v_variant
      from product_variants
      where id = v_row.variant_id and product_id = v_product.id and is_active = true;
      if not found then
        raise exception 'VARIANT_UNAVAILABLE:%', v_row.variant_id using errcode = 'P0001';
      end if;
      v_unit_price := v_variant.price_minor;

      select * into v_inv from inventory
      where product_id = v_product.id and variant_id = v_variant.id
      for update;

      if v_inv.id is null then
        insert into inventory (product_id, variant_id)
        values (v_product.id, v_variant.id)
        returning * into v_inv;
      end if;
    else
      v_variant := null;
      v_unit_price := v_product.price_minor;

      select * into v_inv from inventory
      where product_id = v_product.id and variant_id is null
      for update;

      if v_inv.id is null then
        insert into inventory (product_id) values (v_product.id) returning * into v_inv;
      end if;
    end if;

    v_available := v_inv.stock_on_hand - v_inv.stock_reserved;
    if v_available < v_quantity then
      raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_variant.sku, v_product.sku) using errcode = 'P0001';
    end if;

    v_subtotal := v_subtotal + (v_unit_price * v_quantity);

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'variant_id', v_variant.id,
      'sku', coalesce(v_variant.sku, v_product.sku),
      'name', v_product.name,
      'variant_name', v_variant.name,
      'unit_price_minor', v_unit_price,
      'quantity', v_quantity,
      'line_total_minor', v_unit_price * v_quantity,
      'supplier_sku', null
    ));
  end loop;

  v_total := v_subtotal + v_shipping;

  -- Customer record: attach the authenticated user, otherwise reuse by email.
  select id into v_customer_id from customers
  where (v_user_id is not null and user_id = v_user_id) or lower(email) = v_email
  limit 1;

  if v_customer_id is null then
    insert into customers (user_id, email, full_name, phone, accepts_marketing)
    values (
      v_user_id,
      v_email,
      v_name,
      nullif(trim(coalesce(p_customer ->> 'phone', '')), ''),
      coalesce((p_customer ->> 'accepts_marketing')::boolean, false)
    )
    returning id into v_customer_id;
  else
    update customers
    set user_id = coalesce(user_id, v_user_id),
        full_name = coalesce(nullif(v_name, ''), full_name),
        phone = coalesce(nullif(trim(coalesce(p_customer ->> 'phone', '')), ''), phone)
    where id = v_customer_id;
  end if;

  insert into orders (
    user_id, customer_id, email, phone, shipping_name, shipping_line1, shipping_line2,
    shipping_city, shipping_region, shipping_postcode, shipping_country,
    delivery_notes, subtotal_minor, shipping_minor, discount_minor, total_minor,
    currency, customer_notes, idempotency_key
  ) values (
    v_user_id,
    v_customer_id,
    v_email,
    nullif(trim(coalesce(p_customer ->> 'phone', '')), ''),
    v_name,
    trim(p_customer ->> 'shipping_line1'),
    nullif(trim(coalesce(p_customer ->> 'shipping_line2', '')), ''),
    trim(p_customer ->> 'shipping_city'),
    nullif(trim(coalesce(p_customer ->> 'shipping_region', '')), ''),
    trim(p_customer ->> 'shipping_postcode'),
    upper(coalesce(nullif(trim(p_customer ->> 'shipping_country'), ''), 'GB')),
    nullif(trim(coalesce(p_delivery_notes, '')), ''),
    v_subtotal,
    v_shipping,
    0,
    v_total,
    'GBP',
    nullif(trim(coalesce(p_customer_notes, '')), ''),
    p_idempotency_key
  ) returning * into v_order;

  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    insert into order_items (
      order_id, product_id, variant_id, sku, name, variant_name,
      unit_price_minor, quantity, line_total_minor, supplier_sku
    ) values (
      v_order.id,
      (v_line ->> 'product_id')::uuid,
      nullif(v_line ->> 'variant_id', '')::uuid,
      v_line ->> 'sku',
      v_line ->> 'name',
      nullif(v_line ->> 'variant_name', ''),
      (v_line ->> 'unit_price_minor')::integer,
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'line_total_minor')::integer,
      nullif(v_line ->> 'supplier_sku', '')
    );

    select * into v_inv from inventory
    where product_id = (v_line ->> 'product_id')::uuid
      and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce((nullif(v_line ->> 'variant_id', ''))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
    for update;

    update inventory
    set stock_reserved = stock_reserved + (v_line ->> 'quantity')::integer,
        updated_at = now()
    where id = v_inv.id;

    insert into inventory_movements (
      product_id, variant_id, delta_on_hand, delta_reserved,
      reason, reference_type, reference_id, note, actor
    ) values (
      (v_line ->> 'product_id')::uuid,
      nullif(v_line ->> 'variant_id', '')::uuid,
      0,
      (v_line ->> 'quantity')::integer,
      'order_reserved',
      'order',
      v_order.id,
      'Reserved for ' || v_order.order_number,
      'storefront'
    );

    perform refresh_product_availability((v_line ->> 'product_id')::uuid);
  end loop;

  insert into order_events (order_id, event_type, to_status, message, actor, metadata)
  values (
    v_order.id,
    'order_created',
    v_order.status::text,
    'Order placed on the storefront.',
    'customer',
    jsonb_build_object('total_minor', v_total, 'currency', 'GBP')
  );

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'access_token', v_order.access_token,
    'subtotal_minor', v_order.subtotal_minor,
    'shipping_minor', v_order.shipping_minor,
    'total_minor', v_order.total_minor,
    'currency', v_order.currency,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function create_order(jsonb, jsonb, integer, uuid, text, text, text) from public, anon, authenticated;
grant execute on function create_order(jsonb, jsonb, integer, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- mark_order_paid — called only after server-side payment verification
-- ---------------------------------------------------------------------------
create or replace function mark_order_paid(
  p_order_id uuid,
  p_provider text,
  p_provider_reference text,
  p_amount_minor integer,
  p_currency text default 'GBP',
  p_raw jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order orders;
  v_item order_items;
  v_inv inventory;
  v_existing payment_transactions;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_order.payment_status = 'paid' then
    return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                              'already_paid', true);
  end if;

  if v_order.status = 'cancelled' or v_order.status = 'failed' then
    raise exception 'ORDER_NOT_PAYABLE:%', v_order.status using errcode = 'P0001';
  end if;

  if p_amount_minor < v_order.total_minor then
    raise exception 'PAYMENT_AMOUNT_MISMATCH:%', v_order.total_minor using errcode = 'P0001';
  end if;

  if upper(coalesce(p_currency, 'GBP')) <> v_order.currency then
    raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_existing from payment_transactions
  where provider = p_provider and provider_reference = p_provider_reference;

  if found and v_existing.order_id <> v_order.id then
    raise exception 'PAYMENT_REFERENCE_REUSED' using errcode = 'P0001';
  end if;

  insert into payment_transactions (
    order_id, provider, provider_reference, amount_minor, currency, status, raw_payload
  ) values (
    v_order.id, p_provider, p_provider_reference, p_amount_minor,
    upper(coalesce(p_currency, 'GBP')), 'succeeded', coalesce(p_raw, '{}'::jsonb)
  )
  on conflict (provider, provider_reference)
  do update set status = 'succeeded', raw_payload = excluded.raw_payload, updated_at = now();

  for v_item in select * from order_items where order_id = v_order.id
  loop
    select * into v_inv from inventory
    where product_id = v_item.product_id
      and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(v_item.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    for update;

    if v_inv.id is null then
      continue;
    end if;

    update inventory
    set stock_on_hand = greatest(stock_on_hand - v_item.quantity, 0),
        stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
        updated_at = now()
    where id = v_inv.id;

    insert into inventory_movements (
      product_id, variant_id, delta_on_hand, delta_reserved,
      reason, reference_type, reference_id, note, actor
    ) values (
      v_item.product_id, v_item.variant_id, -v_item.quantity, -v_item.quantity,
      'order_fulfilled', 'order', v_order.id,
      'Committed paid stock for ' || v_order.order_number, 'payment'
    );

    update products
    set sales_count = sales_count + v_item.quantity
    where id = v_item.product_id;

    perform refresh_product_availability(v_item.product_id);
  end loop;

  update orders
  set payment_status = 'paid',
      status = 'awaiting_supplier',
      fulfilment_status = 'awaiting_supplier',
      payment_provider = p_provider,
      paid_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into order_events (order_id, event_type, from_status, to_status, message, actor, metadata)
  values (
    v_order.id, 'payment_confirmed', 'pending_payment', 'awaiting_supplier',
    'Payment verified by the server.', 'system',
    jsonb_build_object('provider', p_provider, 'reference', p_provider_reference,
                       'amount_minor', p_amount_minor)
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'total_minor', v_order.total_minor,
    'already_paid', false
  );
end;
$$;

revoke all on function mark_order_paid(uuid, text, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function mark_order_paid(uuid, text, text, integer, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- cancel_order — releases stock safely and records the reason
-- ---------------------------------------------------------------------------
create or replace function cancel_order(
  p_order_id uuid,
  p_reason text,
  p_actor text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order orders;
  v_item order_items;
  v_inv inventory;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_order.status in ('dispatched', 'delivered') then
    raise exception 'ORDER_ALREADY_DISPATCHED' using errcode = 'P0001';
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('order_id', v_order.id, 'status', 'cancelled', 'already_cancelled', true);
  end if;

  for v_item in select * from order_items where order_id = v_order.id
  loop
    select * into v_inv from inventory
    where product_id = v_item.product_id
      and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(v_item.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    for update;

    if v_inv.id is null then
      continue;
    end if;

    if v_order.payment_status = 'paid' then
      -- Stock was already committed; put it back on hand.
      update inventory
      set stock_on_hand = stock_on_hand + v_item.quantity,
          updated_at = now()
      where id = v_inv.id;

      insert into inventory_movements (
        product_id, variant_id, delta_on_hand, delta_reserved,
        reason, reference_type, reference_id, note, actor
      ) values (
        v_item.product_id, v_item.variant_id, v_item.quantity, 0,
        'correction', 'order', v_order.id,
        'Stock restored after cancelling ' || v_order.order_number, p_actor
      );
    else
      -- Only a reservation existed.
      update inventory
      set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
          updated_at = now()
      where id = v_inv.id;

      insert into inventory_movements (
        product_id, variant_id, delta_on_hand, delta_reserved,
        reason, reference_type, reference_id, note, actor
      ) values (
        v_item.product_id, v_item.variant_id, 0, -v_item.quantity,
        'order_released', 'order', v_order.id,
        'Reservation released after cancelling ' || v_order.order_number, p_actor
      );
    end if;

    perform refresh_product_availability(v_item.product_id);
  end loop;

  update orders
  set status = 'cancelled',
      fulfilment_status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = p_reason
  where id = v_order.id
  returning * into v_order;

  insert into order_events (order_id, event_type, from_status, to_status, message, actor)
  values (v_order.id, 'order_cancelled', 'pending_payment', 'cancelled',
          coalesce(nullif(p_reason, ''), 'Order cancelled.'), p_actor);

  return jsonb_build_object('order_id', v_order.id, 'status', 'cancelled', 'already_cancelled', false);
end;
$$;

revoke all on function cancel_order(uuid, text, text) from public, anon, authenticated;
grant execute on function cancel_order(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Admin status transitions (never changes payment status)
-- ---------------------------------------------------------------------------
create or replace function admin_update_order_status(
  p_order_id uuid,
  p_status order_status,
  p_note text default null,
  p_actor text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order orders;
  v_fulfilment fulfilment_status;
  v_previous order_status;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_order.status = p_status then
    return jsonb_build_object('order_id', v_order.id, 'status', p_status, 'unchanged', true);
  end if;

  if v_order.status in ('cancelled', 'delivered') and p_status <> v_order.status then
    raise exception 'INVALID_STATUS_TRANSITION:%->%', v_order.status, p_status using errcode = 'P0001';
  end if;

  if p_status in ('paid', 'awaiting_supplier', 'submitted_to_supplier', 'supplier_processing', 'dispatched', 'delivered')
     and v_order.payment_status <> 'paid' then
    raise exception 'PAYMENT_NOT_CONFIRMED' using errcode = 'P0001';
  end if;

  v_previous := v_order.status;

  v_fulfilment := case p_status
    when 'paid' then 'unfulfilled'::fulfilment_status
    when 'awaiting_supplier' then 'awaiting_supplier'::fulfilment_status
    when 'submitted_to_supplier' then 'submitted_to_supplier'::fulfilment_status
    when 'supplier_processing' then 'supplier_processing'::fulfilment_status
    when 'dispatched' then 'dispatched'::fulfilment_status
    when 'delivered' then 'delivered'::fulfilment_status
    when 'cancelled' then 'cancelled'::fulfilment_status
    when 'failed' then 'failed'::fulfilment_status
    else v_order.fulfilment_status
  end;

  update orders
  set status = p_status,
      fulfilment_status = v_fulfilment,
      dispatched_at = case when p_status = 'dispatched' then coalesce(dispatched_at, now()) else dispatched_at end,
      delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end
  where id = v_order.id;

  insert into order_events (order_id, event_type, from_status, to_status, message, actor)
  values (v_order.id, 'status_changed', v_previous::text, p_status::text,
          nullif(p_note, ''), p_actor);

  return jsonb_build_object('order_id', v_order.id, 'status', p_status, 'unchanged', false);
end;
$$;

revoke all on function admin_update_order_status(uuid, order_status, text, text) from public, anon, authenticated;
grant execute on function admin_update_order_status(uuid, order_status, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- record_shipment — supplier-confirmed dispatch only
-- ---------------------------------------------------------------------------
create or replace function record_shipment(
  p_order_id uuid,
  p_carrier text,
  p_tracking_number text,
  p_tracking_url text default null,
  p_actor text default 'supplier_sync'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order orders;
  v_previous_status text;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'PAYMENT_NOT_CONFIRMED' using errcode = 'P0001';
  end if;

  if v_order.status in ('cancelled', 'failed') then
    raise exception 'ORDER_NOT_SHIPPABLE:%', v_order.status using errcode = 'P0001';
  end if;

  if v_order.status = 'delivered' then
    return jsonb_build_object('order_id', v_order.id, 'status', 'delivered', 'already_delivered', true);
  end if;

  -- A tracking number is the confirmation of dispatch. The carrier is recorded
  -- when supplied (the admin form asks for both; supplier polling may omit it).
  if trim(coalesce(p_tracking_number, '')) = '' then
    raise exception 'TRACKING_REQUIRED' using errcode = 'P0001';
  end if;

  v_previous_status := v_order.status::text;

  update supplier_orders
  set carrier = coalesce(p_carrier, carrier),
      tracking_number = coalesce(p_tracking_number, tracking_number),
      tracking_url = coalesce(p_tracking_url, tracking_url),
      status = 'dispatched',
      dispatched_at = coalesce(dispatched_at, now()),
      last_synced_at = now()
  where order_id = p_order_id;

  update orders
  set status = 'dispatched',
      fulfilment_status = 'dispatched',
      carrier = coalesce(p_carrier, carrier),
      tracking_number = coalesce(p_tracking_number, tracking_number),
      tracking_url = coalesce(p_tracking_url, tracking_url),
      dispatched_at = coalesce(dispatched_at, now())
  where id = p_order_id
  returning * into v_order;

  insert into order_events (order_id, event_type, from_status, to_status, message, actor, metadata)
  values (
    p_order_id, 'shipment_confirmed', v_previous_status, 'dispatched',
    'Dispatch confirmed by supplier.', p_actor,
    jsonb_build_object('carrier', p_carrier, 'tracking_number', p_tracking_number,
                       'tracking_url', p_tracking_url)
  );

  return jsonb_build_object('order_id', p_order_id, 'status', 'dispatched',
                            'tracking_number', p_tracking_number);
end;
$$;

revoke all on function record_shipment(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function record_shipment(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Stock administration
-- ---------------------------------------------------------------------------
create or replace function admin_adjust_stock(
  p_product_id uuid,
  p_variant_id uuid,
  p_delta integer,
  p_note text default null,
  p_actor text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv inventory;
begin
  if p_delta = 0 then
    raise exception 'NO_CHANGE' using errcode = 'P0001';
  end if;

  select * into v_inv from inventory
  where product_id = p_product_id
    and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  for update;

  if v_inv.id is null then
    insert into inventory (product_id, variant_id)
    values (p_product_id, p_variant_id)
    returning * into v_inv;
  end if;

  if v_inv.stock_on_hand + p_delta < v_inv.stock_reserved then
    raise exception 'STOCK_BELOW_RESERVED:%', v_inv.stock_reserved using errcode = 'P0001';
  end if;

  update inventory
  set stock_on_hand = stock_on_hand + p_delta,
      updated_at = now()
  where id = v_inv.id;

  insert into inventory_movements (
    product_id, variant_id, delta_on_hand, delta_reserved,
    reason, reference_type, note, actor
  ) values (
    p_product_id, p_variant_id, p_delta, 0,
    'manual_adjustment', 'admin', nullif(p_note, ''), p_actor
  );

  perform refresh_product_availability(p_product_id);

  select * into v_inv from inventory where id = v_inv.id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'variant_id', p_variant_id,
    'stock_on_hand', v_inv.stock_on_hand,
    'stock_reserved', v_inv.stock_reserved,
    'low_stock_threshold', v_inv.low_stock_threshold,
    'available', v_inv.stock_on_hand - v_inv.stock_reserved
  );
end;
$$;

revoke all on function admin_adjust_stock(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function admin_adjust_stock(uuid, uuid, integer, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Supplier stock application (batch, transactional)
-- ---------------------------------------------------------------------------
create or replace function apply_supplier_stock_batch(
  p_supplier_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_sp supplier_products;
  v_inv inventory;
  v_new_stock integer;
  v_processed integer := 0;
  v_failed integer := 0;
  v_changed integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_PAYLOAD' using errcode = 'P0001';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    select * into v_sp from supplier_products
    where supplier_id = p_supplier_id
      and supplier_sku = (v_row ->> 'supplier_sku');

    if not found or v_sp.product_id is null then
      v_failed := v_failed + 1;
      continue;
    end if;

    v_new_stock := greatest(coalesce((v_row ->> 'stock')::integer, 0), 0);

    select * into v_inv from inventory
    where product_id = v_sp.product_id
      and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(v_sp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    for update;

    if v_inv.id is null then
      insert into inventory (product_id, variant_id)
      values (v_sp.product_id, v_sp.variant_id)
      returning * into v_inv;
    end if;

    if v_inv.stock_on_hand <> greatest(v_new_stock, v_inv.stock_reserved) then
      insert into inventory_movements (
        product_id, variant_id, delta_on_hand, delta_reserved,
        reason, reference_type, reference_id, note, actor
      ) values (
        v_sp.product_id, v_sp.variant_id,
        greatest(v_new_stock, v_inv.stock_reserved) - v_inv.stock_on_hand,
        0, 'supplier_sync', 'supplier', p_supplier_id,
        'Supplier stock update (' || v_sp.supplier_sku || ')', 'supplier_sync'
      );
      v_changed := v_changed + 1;
    end if;

    update inventory
    set stock_on_hand = greatest(v_new_stock, stock_reserved),
        supplier_stock = v_new_stock,
        last_synced_at = now(),
        updated_at = now()
    where id = v_inv.id;

    update supplier_products
    set supplier_stock = v_new_stock,
        supplier_price_minor = coalesce((v_row ->> 'price_minor')::integer, supplier_price_minor),
        supplier_availability = coalesce(v_row ->> 'availability', supplier_availability),
        last_synced_at = now()
    where id = v_sp.id;

    perform refresh_product_availability(v_sp.product_id);
    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object('processed', v_processed, 'failed', v_failed, 'changed', v_changed);
end;
$$;

revoke all on function apply_supplier_stock_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function apply_supplier_stock_batch(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Expire unpaid orders, releasing their reservations
-- ---------------------------------------------------------------------------
create or replace function release_expired_orders(p_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_count integer := 0;
begin
  for v_order in
    select id from orders
    where status = 'pending_payment'
      and placed_at < now() - make_interval(hours => greatest(p_hours, 1))
  loop
    begin
      perform cancel_order(v_order.id, 'Payment not completed within the reservation window.', 'system');
      v_count := v_count + 1;
    exception when others then
      insert into order_events (order_id, event_type, message, actor)
      values (v_order.id, 'release_failed', sqlerrm, 'system');
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function release_expired_orders(integer) from public, anon, authenticated;
grant execute on function release_expired_orders(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Admin dashboard aggregates
-- ---------------------------------------------------------------------------
create or replace function admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not is_admin() and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_orders', (select count(*) from orders),
    'revenue_minor', (select coalesce(sum(total_minor), 0) from orders where payment_status = 'paid'),
    'pending_orders', (select count(*) from orders where status = 'pending_payment'),
    'processing_orders', (select count(*) from orders where status in ('paid', 'awaiting_supplier', 'submitted_to_supplier', 'supplier_processing')),
    'completed_orders', (select count(*) from orders where status in ('dispatched', 'delivered')),
    'low_stock_count', (
      select count(*) from inventory i
      where i.stock_on_hand - i.stock_reserved > 0
        and i.stock_on_hand - i.stock_reserved <= i.low_stock_threshold
    ),
    'out_of_stock_count', (
      select count(*) from inventory i where i.stock_on_hand - i.stock_reserved = 0
    ),
    'recent_orders', (
      select coalesce(jsonb_agg(row_to_json(o)), '[]'::jsonb)
      from (
        select id, order_number, email, shipping_name, total_minor, currency,
               status, payment_status, fulfilment_status, placed_at
        from orders order by placed_at desc limit 8
      ) o
    ),
    'best_sellers', (
      select coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb)
      from (
        select id, name, sku, sales_count, price_minor
        from products
        where status = 'active' and sales_count > 0
        order by sales_count desc limit 6
      ) p
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function admin_dashboard_stats() from public, anon;
grant execute on function admin_dashboard_stats() to authenticated, service_role;
