import { initLayout, wireNewsletterForms } from '/shared/js/layout.js';
import { setMeta, trackEvent } from '/shared/js/seo.js';

/**
 * Shared boot for editorial and legal pages: renders layout, fills any
 * [data-setting] node from public settings, and sets canonical metadata.
 */
export async function bootStaticPage() {
  const settings = await initLayout();
  wireNewsletterForms();

  document.querySelectorAll('[data-setting]').forEach((node) => {
    const key = node.getAttribute('data-setting');
    const value = settings[key];
    if (!value) return;
    if (node.tagName === 'A' && key === 'store.email') {
      node.href = `mailto:${value}`;
      node.textContent = value;
    } else if (node.tagName === 'A' && key === 'store.phone') {
      node.href = `tel:${value}`;
      node.textContent = value;
    } else {
      node.textContent = value;
    }
  });

  setMeta({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content,
    path: window.location.pathname
  });

  trackEvent('page_view', { page_path: window.location.pathname });
  return settings;
}
