-- ===========================================================================
-- Hasswell London — Public stock view
-- Migration 0006
--
-- The storefront needs to know how many units are actually sellable so the
-- quantity selector cannot promise more than exists. This view exposes *only*
-- the available count (never cost, supplier references or reservation detail).
-- Enforcement still happens inside create_order(), so a tampered client cannot
-- oversell.
-- ===========================================================================

create or replace view product_stock
with (security_barrier = true)
as
select
  i.id,
  i.product_id,
  i.variant_id,
  greatest(i.stock_on_hand - i.stock_reserved, 0) as available,
  i.updated_at
from inventory i;

comment on view product_stock is
  'Public, read-only available-stock counts used by the storefront quantity selector.';

grant select on product_stock to anon, authenticated;
