import { adminApi } from '../api.js';
import { escapeHtml, pageHead, notice, toast, setBusy } from '../ui.js';

/**
 * Store settings are stored as typed key/value rows in store_settings. Only
 * keys in SETTINGS_SPEC are editable, and the server validates every value
 * again on save. Public keys are exposed to the storefront via /api/store/config.
 */

const GROUPS = [
  {
    title: 'Storefront',
    description: 'Public identity shown in the header, footer and transactional emails.',
    keys: [
      'store.name',
      'store.tagline',
      'store.email',
      'store.phone',
      'store.address',
      'store.currency',
      'store.announcement',
      'store.social.instagram'
    ]
  },
  {
    title: 'Delivery & returns',
    description:
      'Rates are stored in pence. Leave shipping at zero until you have confirmed your real delivery charges.',
    keys: [
      'shipping.flat_rate_minor',
      'shipping.free_threshold_minor',
      'shipping.estimate',
      'shipping.regions',
      'shipping.returns_window_days'
    ]
  },
  {
    title: 'Legal',
    description: 'Registration details shown on the legal pages and invoices.',
    keys: ['legal.company_number', 'legal.vat_number']
  }
];

const LABELS = {
  'store.name': 'Store name',
  'store.tagline': 'Tagline',
  'store.email': 'Contact email',
  'store.phone': 'Contact phone',
  'store.address': 'Business address',
  'store.currency': 'Currency code',
  'store.announcement': 'Announcement bar',
  'store.social.instagram': 'Instagram URL',
  'shipping.flat_rate_minor': 'Flat delivery rate (pence)',
  'shipping.free_threshold_minor': 'Free delivery threshold (pence)',
  'shipping.estimate': 'Delivery estimate wording',
  'shipping.regions': 'Delivery regions',
  'shipping.returns_window_days': 'Returns window (days)',
  'legal.company_number': 'Company number',
  'legal.vat_number': 'VAT number'
};

const HINTS = {
  'store.currency': 'Three-letter ISO code, e.g. GBP.',
  'store.announcement': 'Leave blank to hide the announcement bar.',
  'shipping.flat_rate_minor': 'Pence. 495 = £4.95. Zero means delivery is included.',
  'shipping.free_threshold_minor': 'Pence. Orders at or above this subtotal ship free. Zero disables the threshold.',
  'shipping.estimate': 'Only state a timeframe you can actually meet.',
  'shipping.regions': 'Comma-separated two-letter country codes, e.g. GB, IE, FR.',
  'shipping.returns_window_days': 'Does not override your legal obligations.',
  'store.social.instagram': 'Full URL including https://.'
};

function valueFor(item, key) {
  const value = item?.value;
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined) return '';
  return String(value);
}

function fieldFor(key, spec, value) {
  const label = LABELS[key] || key;
  const hint = HINTS[key] || '';
  const id = `setting-${key.replaceAll('.', '-')}`;

  const control =
    spec.type === 'regions'
      ? `<input class="input" id="${id}" data-setting="${escapeHtml(key)}" data-type="regions"
           type="text" value="${escapeHtml(value)}" placeholder="GB, IE, FR">`
      : spec.type === 'int'
        ? `<input class="input" id="${id}" data-setting="${escapeHtml(key)}" data-type="int"
             type="number" min="${spec.min ?? 0}" max="${spec.max ?? 100000000}" step="1"
             value="${escapeHtml(value)}">`
        : spec.type === 'email'
          ? `<input class="input" id="${id}" data-setting="${escapeHtml(key)}" data-type="string"
               type="email" maxlength="${spec.max || 254}" value="${escapeHtml(value)}">`
          : `<input class="input" id="${id}" data-setting="${escapeHtml(key)}" data-type="string"
               type="text" maxlength="${spec.max || 300}" value="${escapeHtml(value)}">`;

  return `<div class="field">
    <label for="${id}">${escapeHtml(label)}</label>
    ${control}
    ${hint ? `<span class="field__hint">${escapeHtml(hint)}</span>` : ''}
  </div>`;
}

export async function renderSettings(view) {
  view.innerHTML = '<div class="empty">Loading settings…</div>';

  let data;
  try {
    data = await adminApi('/settings');
  } catch (error) {
    view.innerHTML = notice(escapeHtml(error.message), 'error');
    return;
  }

  const items = new Map((data.items ?? []).map((item) => [item.key, item]));
  const spec = data.spec ?? {};

  view.innerHTML = `
    ${pageHead({
      title: 'Settings',
      subtitle: 'Storefront identity, delivery and legal details.',
      actions: `<a class="btn btn--ghost" href="/api/store/config" target="_blank" rel="noopener">Public config</a>`
    })}

    <div id="settings-error" hidden></div>

    <form id="settings-form">
      ${GROUPS.map(
        (group) => `<section class="card">
          <div class="card__head"><h3>${escapeHtml(group.title)}</h3></div>
          <div class="card__body">
            <p class="small muted" style="margin-bottom:1rem">${escapeHtml(group.description)}</p>
            <div class="form-grid">
              ${group.keys
                .filter((key) => spec[key])
                .map((key) => fieldFor(key, spec[key], valueFor(items.get(key), key)))
                .join('')}
            </div>
          </div>
        </section>`
      ).join('')}

      <div class="form-actions">
        <button class="btn" type="submit" id="save-settings">Save settings</button>
      </div>
    </form>

    <section class="card" style="margin-top:1.2rem">
      <div class="card__head"><h3>Configuration notes</h3></div>
      <div class="card__body stack small">
        ${notice(
          'Changing the currency after orders exist does not convert historic amounts. Prices are stored in minor units.',
          'warn'
        )}
        ${notice(
          'Payment provider keys, email credentials and supplier tokens are environment variables in Vercel, not database settings. They are never shown in this dashboard.',
          ''
        )}
      </div>
    </section>`;

  const form = view.querySelector('#settings-form');
  const errorBox = view.querySelector('#settings-error');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;

    const settings = {};
    for (const input of form.querySelectorAll('[data-setting]')) {
      const key = input.dataset.setting;
      const type = input.dataset.type;
      const raw = input.value;

      if (type === 'int') {
        const number = Number(raw);
        if (!Number.isInteger(number) || number < 0) {
          errorBox.hidden = false;
          errorBox.innerHTML = notice(
            `Enter a valid whole number for ${escapeHtml(LABELS[key] || key)}.`,
            'error'
          );
          input.focus();
          return;
        }
        settings[key] = number;
      } else if (type === 'regions') {
        const regions = raw
          .split(',')
          .map((code) => code.trim().toUpperCase())
          .filter(Boolean);
        if (!regions.length) {
          errorBox.hidden = false;
          errorBox.innerHTML = notice('Enter at least one delivery region.', 'error');
          input.focus();
          return;
        }
        settings[key] = regions;
      } else {
        settings[key] = raw.trim();
      }
    }

    const button = view.querySelector('#save-settings');
    setBusy(button, true, 'Saving…');
    try {
      await adminApi('/settings', { method: 'PATCH', body: { settings } });
      toast('Settings saved.', 'success');
    } catch (error) {
      errorBox.hidden = false;
      errorBox.innerHTML = notice(escapeHtml(error.message), 'error');
      errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      setBusy(button, false);
    }
  });
}
