import { handler, assertMethod } from './_lib/http.js';
import { siteUrl } from './_lib/env.js';

export default handler(async (req, res) => {
  assertMethod(req, ['GET']);
  const base = siteUrl();

  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin/
Disallow: /api/
Disallow: /cart
Disallow: /checkout
Disallow: /order-confirmation
Disallow: /account
Disallow: /login
Disallow: /register

Sitemap: ${base}/sitemap.xml
`;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.end(body);
});
