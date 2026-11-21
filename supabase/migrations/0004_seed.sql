-- ===========================================================================
-- Hasswell London — Launch seed data
-- Migration 0004
--
-- This is a *launch catalogue* stored in the database (not hardcoded in the
-- frontend). Replace imagery and copy from the admin panel, or import the
-- client's real AW Dropship products once credentials are available.
-- Product imagery is deliberately neutral branded artwork until photography
-- is supplied. See docs/setup.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Store settings
-- ---------------------------------------------------------------------------
insert into store_settings (key, value, is_public) values
  ('store.name', '"Hasswell London"', true),
  ('store.tagline', '"Considered objects for the modern British home."', true),
  ('store.email', '"hello@hasswelllondon.co.uk"', true),
  ('store.phone', '""', true),
  ('store.address', '"London, United Kingdom"', true),
  ('store.currency', '"GBP"', true),
  ('store.announcement', '"Complimentary UK delivery on orders over £75"', true),
  ('shipping.flat_rate_minor', '0', true),
  ('shipping.free_threshold_minor', '0', true),
  ('shipping.estimate', '""', true),
  ('shipping.regions', '["GB"]', true),
  ('shipping.returns_window_days', '30', true),
  ('store.social.instagram', '"https://instagram.com/"', true),
  ('legal.company_number', '""', true),
  ('legal.vat_number', '""', true)
on conflict (key) do nothing;

-- Supplier account: deliberately inactive until credentials are configured
-- and the client's AW Dropship plan is confirmed to include API access.
insert into supplier_accounts (
  name, slug, connector, is_active, api_base_url, credentials_ref,
  capabilities, notes
) values (
  'AW Dropship',
  'aw-dropship',
  'aw-dropship',
  false,
  'https://api.aiku.io',
  'AW_DROPSHIP_API_TOKEN',
  jsonb_build_object(
    'product_import', true,
    'stock_sync', true,
    'price_sync', true,
    'order_submission', true,
    'order_status_polling', true,
    'tracking_retrieval', true,
    'webhooks', false,
    'verified_live', false
  ),
  'Capabilities are based on AW Dropship''s published Manual/API channel documentation. Order submission body shapes must be verified against the token holder''s API documentation before enabling.'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
insert into categories (id, name, slug, description, sort_order) values
  ('11111111-1111-4111-8111-111111111101', 'Candles', 'candles', 'Hand-poured candles with a considered, slow burn.', 10),
  ('11111111-1111-4111-8111-111111111102', 'Home Fragrance', 'home-fragrance', 'Reed diffusers and room mists for quiet rooms.', 20),
  ('11111111-1111-4111-8111-111111111103', 'Bath & Body', 'bath-body', 'Everyday washes and creams made in small batches.', 30),
  ('11111111-1111-4111-8111-111111111104', 'Home & Living', 'home-living', 'Textiles and objects that soften a room.', 40),
  ('11111111-1111-4111-8111-111111111105', 'Kitchen', 'kitchen', 'Simple tools for the daily ritual of making.', 50),
  ('11111111-1111-4111-8111-111111111106', 'Tea & Pantry', 'tea-pantry', 'Teas and small provisions from British makers.', 60)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
insert into products (
  id, sku, slug, name, brand, short_description, description,
  price_minor, compare_at_price_minor, status, is_featured, is_best_seller,
  is_new_arrival, weight_grams, meta_title, meta_description, published_at
) values
  (
    '22222222-2222-4222-8222-222222222201', 'HL-CAN-001', 'cedar-amber-candle',
    'Cedar & Amber Candle', 'Hasswell London',
    'Cedarwood, amber and a trace of woodsmoke. Hand-poured in small batches.',
    'A grounded evening scent. Virginia cedarwood is warmed with amber resin and a trace of woodsmoke, then poured into a hand-finished amber glass vessel. The cotton wick is centred by hand so the wax burns evenly to the edge. Presented in a recycled board box, ready to give.',
    3800, 4500, 'active', true, true, false, 620,
    'Cedar & Amber Candle | Hasswell London',
    'A hand-poured cedarwood and amber candle in amber glass. Made in small batches in the United Kingdom.',
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222202', 'HL-FRG-002', 'fig-cassis-reed-diffuser',
    'Fig & Cassis Reed Diffuser', 'Hasswell London',
    'Black fig, cassis leaf and cedar. Six months of quiet fragrance.',
    'A still-life for a hallway or study. Ripe fig and sharp cassis leaf settle into a soft cedar base, carried on natural rattan reeds. The frosted glass vessel holds enough oil for several months of continuous scent. Turn the reeds weekly to refresh.',
    4200, null, 'active', true, true, true, 540,
    'Fig & Cassis Reed Diffuser | Hasswell London',
    'Fig, cassis and cedar reed diffuser in frosted glass. Long-lasting home fragrance.',
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222203', 'HL-BTH-003', 'hawthorn-hand-wash',
    'Hawthorn Hand Wash', 'Hasswell London',
    'A gentle daily wash with hawthorn, birch and bergamot.',
    'Made in small batches with a low-foaming, pH-balanced base. Hawthorn and birch extracts are joined by cold-pressed bergamot for a clean, green finish. The aluminium pump bottle is designed to be refilled rather than replaced.',
    2400, null, 'active', false, false, true, 420,
    'Hawthorn Hand Wash | Hasswell London',
    'Gentle hawthorn and bergamot hand wash in a refillable aluminium bottle.',
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222204', 'HL-HOM-004', 'british-wool-throw',
    'British Wool Throw', 'Hasswell London',
    'Woven in Yorkshire from undyed British wool. A generous 180 × 130cm.',
    'A throw with weight and warmth. Woven on traditional looms in Yorkshire from undyed British wool, with a hand-knotted fringe and a soft, slightly rustic handle. The natural ecru colour comes from the fleece itself — no dye is used.',
    12000, 14500, 'active', true, false, false, 1400,
    'British Wool Throw | Hasswell London',
    'Undyed British wool throw, woven in Yorkshire. 180 × 130cm with hand-knotted fringe.',
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222205', 'HL-KIT-005', 'stoneware-pour-over-set',
    'Stoneware Pour-Over Set', 'Hasswell London',
    'A hand-thrown dripper and carafe in a warm oatmeal glaze.',
    'For a slower morning. The dripper and carafe are thrown by hand in Stoke-on-Trent, then finished in a matte oatmeal glaze that softens with use. The ribbed funnel takes a standard paper filter. Each piece varies slightly in tone and weight.',
    5800, null, 'active', false, true, false, 1100,
    'Stoneware Pour-Over Set | Hasswell London',
    'Hand-thrown stoneware coffee dripper and carafe in an oatmeal glaze. Made in Stoke-on-Trent.',
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222206', 'HL-TEA-006', 'earl-grey-no-7',
    'Earl Grey No. 7', 'Hasswell London',
    'Ceylon black tea, bergamot and a little blue cornflower.',
    'A cleaner, less perfumed Earl Grey. Single-origin Ceylon leaves are scented with cold-pressed bergamot and finished with blue cornflower petals. Loose leaf, packed in a resealable tin. Brew for three minutes in water just off the boil.',
    1800, null, 'active', false, false, true, 180,
    'Earl Grey No. 7 | Hasswell London',
    'Loose-leaf Ceylon Earl Grey with cold-pressed bergamot, packed in a resealable tin.',
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222207', 'HL-BTH-007', 'botanists-hand-cream-trio',
    'Botanist''s Hand Cream Trio', 'Hasswell London',
    'Three 30ml creams: hawthorn, wild rose and sweet fennel.',
    'A trio of unfussy hand creams for desk, bag and bedside. Each is made with shea butter and British botanical extracts, absorbs without residue and is scented lightly enough to layer. Boxed as a set of three 30ml aluminium tubes.',
    3200, 3800, 'active', true, true, false, 260,
    'Botanist''s Hand Cream Trio | Hasswell London',
    'Three 30ml botanical hand creams with shea butter: hawthorn, wild rose and sweet fennel.',
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222208', 'HL-HOM-008', 'oak-leather-desk-tray',
    'Oak & Leather Desk Tray', 'Hasswell London',
    'Solid oak with a vegetable-tanned leather base.',
    'A place for the things that accumulate on a desk. The frame is solid European oak, finished with hard wax oil; the base is vegetable-tanned leather that darkens with handling. Felt pads protect the surface beneath.',
    6400, null, 'active', false, false, false, 780,
    'Oak & Leather Desk Tray | Hasswell London',
    'Solid oak desk tray with a vegetable-tanned leather base. Made in small batches.',
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222209', 'HL-HOM-009', 'washed-linen-cushion',
    'Washed Linen Cushion', 'Hasswell London',
    'Stonewashed European linen in a soft, undyed ecru.',
    'A cushion that looks better creased. Woven from European flax and stonewashed for a soft, lived-in handle, with a concealed zip and a duck-feather pad included. The ecru shade is undyed, so tone varies gently between pieces.',
    5400, null, 'active', false, false, true, 900,
    'Washed Linen Cushion | Hasswell London',
    'Stonewashed European linen cushion in undyed ecru, with duck-feather pad included.',
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222210', 'HL-BTH-010', 'rosemary-mint-soap',
    'Rosemary & Mint Soap', 'Hasswell London',
    'Cold-processed soap with rosemary, peppermint and olive oil.',
    'Cured for six weeks and cut by hand. Olive and coconut oils make a dense, creamy lather; rosemary and peppermint oils leave a clean, herbal finish. Each bar is stamped and wrapped in paper. 120g.',
    1400, null, 'active', false, false, false, 140,
    'Rosemary & Mint Soap | Hasswell London',
    'Cold-processed rosemary and peppermint soap, cured for six weeks. 120g bar.',
    now()
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Product images (branded launch artwork; replace with photography)
-- ---------------------------------------------------------------------------
insert into product_images (product_id, url, alt, sort_order, is_primary) values
  ('22222222-2222-4222-8222-222222222201', '/assets/products/cedar-amber-candle.svg', 'Cedar & Amber Candle in amber glass', 0, true),
  ('22222222-2222-4222-8222-222222222202', '/assets/products/fig-cassis-diffuser.svg', 'Fig & Cassis Reed Diffuser in frosted glass', 0, true),
  ('22222222-2222-4222-8222-222222222203', '/assets/products/hawthorn-hand-wash.svg', 'Hawthorn Hand Wash in an aluminium pump bottle', 0, true),
  ('22222222-2222-4222-8222-222222222204', '/assets/products/british-wool-throw.svg', 'British Wool Throw folded on a bench', 0, true),
  ('22222222-2222-4222-8222-222222222205', '/assets/products/pour-over-set.svg', 'Stoneware pour-over dripper and carafe', 0, true),
  ('22222222-2222-4222-8222-222222222206', '/assets/products/earl-grey-tin.svg', 'Earl Grey No. 7 tea tin', 0, true),
  ('22222222-2222-4222-8222-222222222207', '/assets/products/hand-cream-trio.svg', 'Three botanical hand cream tubes', 0, true),
  ('22222222-2222-4222-8222-222222222208', '/assets/products/oak-desk-tray.svg', 'Oak and leather desk tray', 0, true),
  ('22222222-2222-4222-8222-222222222209', '/assets/products/linen-cushion.svg', 'Washed linen cushion in ecru', 0, true),
  ('22222222-2222-4222-8222-222222222210', '/assets/products/rosemary-mint-soap.svg', 'Rosemary and mint soap bar', 0, true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Product ↔ category
-- ---------------------------------------------------------------------------
insert into product_categories (product_id, category_id) values
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111101'),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111102'),
  ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111103'),
  ('22222222-2222-4222-8222-222222222204', '11111111-1111-4111-8111-111111111104'),
  ('22222222-2222-4222-8222-222222222205', '11111111-1111-4111-8111-111111111105'),
  ('22222222-2222-4222-8222-222222222206', '11111111-1111-4111-8111-111111111106'),
  ('22222222-2222-4222-8222-222222222207', '11111111-1111-4111-8111-111111111103'),
  ('22222222-2222-4222-8222-222222222208', '11111111-1111-4111-8111-111111111104'),
  ('22222222-2222-4222-8222-222222222209', '11111111-1111-4111-8111-111111111104'),
  ('22222222-2222-4222-8222-222222222210', '11111111-1111-4111-8111-111111111103')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Variants (price is the effective unit price; product price is the minimum)
-- ---------------------------------------------------------------------------
insert into product_variants (
  id, product_id, sku, name, options, price_minor, is_active, sort_order
) values
  ('33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222201', 'HL-CAN-001-S', '180g', '{"size":"180g"}', 3800, true, 0),
  ('33333333-3333-4333-8333-333333333302', '22222222-2222-4222-8222-222222222201', 'HL-CAN-001-L', '380g', '{"size":"380g"}', 5800, true, 1),
  ('33333333-3333-4333-8333-333333333303', '22222222-2222-4222-8222-222222222206', 'HL-TEA-006-40', '40g tin', '{"size":"40g"}', 1800, true, 0),
  ('33333333-3333-4333-8333-333333333304', '22222222-2222-4222-8222-222222222206', 'HL-TEA-006-100', '100g tin', '{"size":"100g"}', 3400, true, 1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------
insert into inventory (product_id, variant_id, stock_on_hand, stock_reserved, low_stock_threshold, supplier_stock) values
  ('22222222-2222-4222-8222-222222222201', '33333333-3333-4333-8333-333333333301', 24, 0, 5, null),
  ('22222222-2222-4222-8222-222222222201', '33333333-3333-4333-8333-333333333302', 9, 0, 3, null),
  ('22222222-2222-4222-8222-222222222202', null, 18, 0, 4, null),
  ('22222222-2222-4222-8222-222222222203', null, 3, 0, 5, null),
  ('22222222-2222-4222-8222-222222222204', null, 6, 0, 2, null),
  ('22222222-2222-4222-8222-222222222205', null, 0, 0, 3, null),
  ('22222222-2222-4222-8222-222222222206', '33333333-3333-4333-8333-333333333303', 40, 0, 8, null),
  ('22222222-2222-4222-8222-222222222206', '33333333-3333-4333-8333-333333333304', 12, 0, 4, null),
  ('22222222-2222-4222-8222-222222222207', null, 31, 0, 6, null),
  ('22222222-2222-4222-8222-222222222208', null, 7, 0, 2, null),
  ('22222222-2222-4222-8222-222222222209', null, 15, 0, 4, null),
  ('22222222-2222-4222-8222-222222222210', null, 52, 0, 10, null)
on conflict do nothing;

-- Record the opening stock as an auditable movement.
insert into inventory_movements (
  product_id, variant_id, delta_on_hand, delta_reserved, reason, note, actor
)
select i.product_id, i.variant_id, i.stock_on_hand, 0, 'import',
       'Opening stock recorded at launch seed.', 'seed'
from inventory i
where not exists (
  select 1 from inventory_movements m
  where m.product_id = i.product_id
    and coalesce(m.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(i.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Derive availability exactly as the application would.
do $$
declare
  v_id uuid;
begin
  for v_id in select id from products loop
    perform refresh_product_availability(v_id);
  end loop;
end $$;
