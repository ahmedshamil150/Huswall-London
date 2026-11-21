import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const root = process.cwd();

/**
 * Clean URLs (e.g. /shop, /product/cedar-candle) are handled by Vercel in
 * production. This middleware reproduces the same behaviour under `vite dev`
 * so both environments resolve the identical paths.
 */
function cleanUrlsDev() {
  const pageMap = {
    '/': 'store/index.html',
    '/shop': 'store/shop.html',
    '/cart': 'store/cart.html',
    '/checkout': 'store/checkout.html',
    '/order-confirmation': 'store/order-confirmation.html',
    '/account': 'store/account.html',
    '/login': 'store/login.html',
    '/register': 'store/register.html',
    '/about': 'store/about.html',
    '/contact': 'store/contact.html',
    '/delivery-returns': 'store/delivery-returns.html',
    '/faqs': 'store/faqs.html',
    '/privacy': 'store/privacy.html',
    '/cookies': 'store/cookies.html',
    '/terms': 'store/terms.html',
    '/admin': 'admin/index.html',
    '/admin/login': 'admin/index.html'
  };

  return {
    name: 'hasswell-clean-urls',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        let target = null;

        if (pageMap[url.pathname]) {
          const file = resolve(root, pageMap[url.pathname]);
          if (existsSync(file)) {
            res.setHeader('Content-Type', 'text/html');
            res.end(readFileSync(file));
            return;
          }
        }

        const productMatch = url.pathname.match(/^\/product\/([^/]+)$/);
        const adminMatch = url.pathname.match(/^\/admin\/[^/]+$/);
        if (productMatch || adminMatch) {
          const file = resolve(root, adminMatch ? 'admin/index.html' : 'store/product.html');
          res.setHeader('Content-Type', 'text/html');
          res.end(readFileSync(file));
          return;
        }

        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [cleanUrlsDev()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        home: resolve(root, 'store/index.html'),
        shop: resolve(root, 'store/shop.html'),
        product: resolve(root, 'store/product.html'),
        cart: resolve(root, 'store/cart.html'),
        checkout: resolve(root, 'store/checkout.html'),
        orderConfirmation: resolve(root, 'store/order-confirmation.html'),
        account: resolve(root, 'store/account.html'),
        login: resolve(root, 'store/login.html'),
        register: resolve(root, 'store/register.html'),
        about: resolve(root, 'store/about.html'),
        contact: resolve(root, 'store/contact.html'),
        deliveryReturns: resolve(root, 'store/delivery-returns.html'),
        faqs: resolve(root, 'store/faqs.html'),
        privacy: resolve(root, 'store/privacy.html'),
        cookies: resolve(root, 'store/cookies.html'),
        terms: resolve(root, 'store/terms.html'),
        admin: resolve(root, 'admin/index.html')
      }
    }
  },
  server: {
    port: 5173,
    strictPort: false
  }
});
