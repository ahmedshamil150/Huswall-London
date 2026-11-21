import { supabase, requireSupabase } from './supabase.js';

const PRODUCT_SELECT = `
  id, sku, slug, name, brand, short_description, description,
  price_minor, compare_at_price_minor, currency, availability,
  is_featured, is_best_seller, is_new_arrival, sales_count,
  weight_grams, meta_title, meta_description, published_at, created_at,
  product_images ( url, alt, sort_order, is_primary ),
  product_categories ( categories ( id, name, slug ) ),
  product_variants ( id, sku, name, options, price_minor, compare_at_price_minor, availability, is_active, sort_order )
`;

const SORTS = {
  featured: { column: 'is_featured', ascending: false },
  newest: { column: 'published_at', ascending: false },
  popular: { column: 'sales_count', ascending: false },
  price_asc: { column: 'price_minor', ascending: true },
  price_desc: { column: 'price_minor', ascending: false },
  name_asc: { column: 'name', ascending: true }
};

function sanitiseSearch(term) {
  return String(term)
    .trim()
    .slice(0, 60)
    .replace(/[%,()]/g, ' ');
}

export function mapProduct(row) {
  if (!row) return null;
  const images = [...(row.product_images ?? [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order
  );
  const variants = [...(row.product_variants ?? [])]
    .filter((variant) => variant.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);
  const categories = (row.product_categories ?? [])
    .map((link) => link.categories)
    .filter(Boolean);

  return {
    ...row,
    images: images.length ? images : [{ url: '/assets/products/placeholder.svg', alt: row.name, is_primary: true }],
    primaryImage: images[0]?.url ?? '/assets/products/placeholder.svg',
    variants,
    hasVariants: variants.length > 0,
    categories,
    category: categories[0] ?? null,
    inStock: row.availability !== 'out_of_stock' && row.availability !== 'unavailable',
    lowStock: row.availability === 'low_stock',
    onSale: Boolean(row.compare_at_price_minor && row.compare_at_price_minor > row.price_minor)
  };
}

export async function getCategories() {
  const db = requireSupabase();
  const { data, error } = await db
    .from('categories')
    .select('id, name, slug, description, image_url, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getCategoryCounts() {
  const db = requireSupabase();
  const { data, error } = await db
    .from('product_categories')
    .select('category_id, products!inner(status)')
    .eq('products.status', 'active');
  if (error) {
    console.warn('[catalog] category counts unavailable:', error.message);
    return {};
  }
  return (data ?? []).reduce((acc, row) => {
    acc[row.category_id] = (acc[row.category_id] ?? 0) + 1;
    return acc;
  }, {});
}

async function productIdsForCategory(categorySlug) {
  const db = requireSupabase();
  const { data: category, error: categoryError } = await db
    .from('categories')
    .select('id')
    .eq('slug', categorySlug)
    .eq('is_active', true)
    .maybeSingle();
  if (categoryError) throw categoryError;
  if (!category) return [];

  const { data, error } = await db
    .from('product_categories')
    .select('product_id')
    .eq('category_id', category.id);
  if (error) throw error;
  return (data ?? []).map((row) => row.product_id);
}

/**
 * Paginated catalogue query. All filtering happens in Postgres.
 */
export async function getProducts({
  categorySlug = null,
  search = '',
  sort = 'featured',
  page = 1,
  pageSize = 12,
  featured = false,
  bestSeller = false,
  newArrival = false,
  inStockOnly = false,
  excludeId = null
} = {}) {
  const db = requireSupabase();
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(48, Math.max(1, Number(pageSize) || 12));

  let query = db
    .from('products')
    .select(PRODUCT_SELECT, { count: 'exact' })
    .eq('status', 'active');

  if (categorySlug) {
    const ids = await productIdsForCategory(categorySlug);
    if (!ids.length) return { items: [], total: 0, page: safePage, pageSize: safeSize, totalPages: 0 };
    query = query.in('id', ids);
  }
  if (search) {
    const term = sanitiseSearch(search);
    if (term) {
      query = query.or(
        `name.ilike.%${term}%,sku.ilike.%${term}%,short_description.ilike.%${term}%,brand.ilike.%${term}%`
      );
    }
  }
  if (featured) query = query.eq('is_featured', true);
  if (bestSeller) query = query.eq('is_best_seller', true);
  if (newArrival) query = query.eq('is_new_arrival', true);
  if (inStockOnly) query = query.in('availability', ['in_stock', 'low_stock', 'preorder']);
  if (excludeId) query = query.neq('id', excludeId);

  const sortSpec = SORTS[sort] ?? SORTS.featured;
  query = query
    .order(sortSpec.column, { ascending: sortSpec.ascending, nullsFirst: false })
    .order('created_at', { ascending: false });

  const from = (safePage - 1) * safeSize;
  query = query.range(from, from + safeSize - 1);

  const { data, count, error } = await query;
  if (error) throw error;

  const total = count ?? 0;
  return {
    items: (data ?? []).map(mapProduct),
    total,
    page: safePage,
    pageSize: safeSize,
    totalPages: Math.max(1, Math.ceil(total / safeSize))
  };
}

export async function getProductBySlug(slug) {
  const db = requireSupabase();
  const { data, error } = await db
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('slug', slug)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return data ? mapProduct(data) : null;
}

export async function getRelatedProducts(product, limit = 4) {
  const db = requireSupabase();
  const categorySlug = product?.category?.slug;

  if (categorySlug) {
    const ids = await productIdsForCategory(categorySlug);
    const filtered = ids.filter((id) => id !== product.id);
    if (filtered.length) {
      const { data, error } = await db
        .from('products')
        .select(PRODUCT_SELECT)
        .eq('status', 'active')
        .in('id', filtered)
        .limit(limit);
      if (!error && data?.length) return data.map(mapProduct);
    }
  }

  const { data, error } = await db
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('status', 'active')
    .neq('id', product.id)
    .order('sales_count', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapProduct);
}

/**
 * Available-to-sell quantity. The view exposes only stock counts, never costs
 * or supplier data, and is used to keep the quantity selector honest.
 */
export async function getProductStock(productId) {
  if (!supabase || !productId) return null;
  const { data, error } = await supabase
    .from('product_stock')
    .select('variant_id, available')
    .eq('product_id', productId);
  if (error) {
    console.warn('[catalog] stock view unavailable:', error.message);
    return null;
  }
  return data ?? [];
}

export async function getProductReviews() {
  // Reserved for a future verified-purchase review module. Kept out of scope
  // rather than shipping unverified customer reviews.
  return [];
}
