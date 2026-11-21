import { config } from './config.js';

function upsertMeta(selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement('meta');
    document.head.append(node);
  }
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
}

function upsertLink(rel, href) {
  let node = document.head.querySelector(`link[rel="${rel}"]`);
  if (!node) {
    node = document.createElement('link');
    node.setAttribute('rel', rel);
    document.head.append(node);
  }
  node.setAttribute('href', href);
}

/**
 * Page-level SEO. Canonical URLs always use the configured production origin
 * so preview deployments do not compete with the live domain.
 */
export function setMeta({
  title,
  description,
  path = window.location.pathname,
  image = '/assets/og-default.svg',
  type = 'website',
  noindex = false,
  jsonLd = null
}) {
  if (title) document.title = title;

  if (description) {
    upsertMeta('meta[name="description"]', { name: 'description', content: description });
  }

  upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: 'Hasswell London' });
  upsertMeta('meta[property="og:type"]', { property: 'og:type', content: type });
  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title || document.title });
  if (description) {
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description });
  }
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: `${config.siteUrl}${path}` });

  const absoluteImage = image?.startsWith('http') ? image : `${config.siteUrl}${image}`;
  upsertMeta('meta[property="og:image"]', { property: 'og:image', content: absoluteImage });
  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title || document.title });
  if (description) {
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description });
  }
  upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: absoluteImage });

  upsertLink('canonical', `${config.siteUrl}${path}`);

  if (noindex) {
    upsertMeta('meta[name="robots"]', { name: 'robots', content: 'noindex, nofollow' });
  } else {
    const robots = document.head.querySelector('meta[name="robots"]');
    if (robots) robots.remove();
  }

  if (jsonLd) setJsonLd(jsonLd);
}

export function setJsonLd(data) {
  const id = 'page-structured-data';
  document.getElementById(id)?.remove();
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = id;
  script.textContent = JSON.stringify(data);
  document.head.append(script);
}

export function productJsonLd(product) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.short_description || product.description || '',
    sku: product.sku,
    brand: { '@type': 'Brand', name: product.brand || 'Hasswell London' },
    image: product.images.map((img) => (img.url.startsWith('http') ? img.url : `${config.siteUrl}${img.url}`)),
    url: `${config.siteUrl}/product/${product.slug}`,
    ...(product.variants.length
      ? {
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: product.currency,
            lowPrice: (Math.min(...product.variants.map((v) => v.price_minor)) / 100).toFixed(2),
            highPrice: (Math.max(...product.variants.map((v) => v.price_minor)) / 100).toFixed(2),
            offerCount: product.variants.length,
            availability: product.inStock
              ? 'https://schema.org/InStock'
              : 'https://schema.org/OutOfStock',
            seller: { '@type': 'Organization', name: 'Hasswell London' }
          }
        }
      : {
          offers: {
            '@type': 'Offer',
            priceCurrency: product.currency,
            price: (product.price_minor / 100).toFixed(2),
            availability: product.inStock
              ? 'https://schema.org/InStock'
              : 'https://schema.org/OutOfStock',
            url: `${config.siteUrl}/product/${product.slug}`,
            seller: { '@type': 'Organization', name: 'Hasswell London' }
          }
        })
  };
}

export function organisationJsonLd(settings = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: settings['store.name'] || 'Hasswell London',
    url: config.siteUrl,
    logo: `${config.siteUrl}/assets/og-default.svg`,
    email: settings['store.email'] || undefined,
    address: settings['store.address'] || undefined
  };
}

export function breadcrumbJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${config.siteUrl}${item.path}`
    }))
  };
}

/** GA4 loads only when a measurement ID is configured. */
export function initAnalytics() {
  if (!config.gaMeasurementId) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${config.gaMeasurementId}`;
  document.head.append(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', config.gaMeasurementId, { anonymize_ip: true });
}

export function trackEvent(name, params = {}) {
  if (typeof window.gtag === 'function') window.gtag('event', name, params);
}
