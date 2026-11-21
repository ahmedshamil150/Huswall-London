import { handler, assertMethod } from './_lib/http.js';
import { serviceClient } from './_lib/supabase.js';
import { siteUrl } from './_lib/env.js';

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const STATIC_PAGES = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/shop', changefreq: 'daily', priority: '0.9' },
  { path: '/about', changefreq: 'monthly', priority: '0.5' },
  { path: '/contact', changefreq: 'monthly', priority: '0.4' },
  { path: '/delivery-returns', changefreq: 'monthly', priority: '0.4' },
  { path: '/faqs', changefreq: 'monthly', priority: '0.4' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { path: '/cookies', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms', changefreq: 'yearly', priority: '0.3' }
];

export default handler(async (req, res) => {
  assertMethod(req, ['GET']);
  const base = siteUrl();

  let products = [];
  let categories = [];

  try {
    const db = serviceClient();
    const [productResult, categoryResult] = await Promise.all([
      db
        .from('products')
        .select('slug, updated_at')
        .eq('status', 'active')
        .order('published_at', { ascending: false }),
      db.from('categories').select('slug, updated_at').eq('is_active', true).order('sort_order')
    ]);
    products = productResult.data ?? [];
    categories = categoryResult.data ?? [];
  } catch (error) {
    console.error('[sitemap] catalogue query failed:', error?.message);
  }

  const urls = [
    ...STATIC_PAGES.map(
      (page) => `  <url>
    <loc>${escapeXml(`${base}${page.path}`)}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
    ),
    ...categories.map(
      (category) => `  <url>
    <loc>${escapeXml(`${base}/shop?category=${encodeURIComponent(category.slug)}`)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`
    ),
    ...products.map(
      (product) => `  <url>
    <loc>${escapeXml(`${base}/product/${encodeURIComponent(product.slug)}`)}</loc>
    ${product.updated_at ? `<lastmod>${new Date(product.updated_at).toISOString()}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`
    )
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.end(xml);
});
