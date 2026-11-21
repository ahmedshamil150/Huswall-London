import { bootStaticPage } from '/shared/js/page-boot.js';
import { apiFetch } from '/shared/js/api.js';
import { qs, setBusy, escapeHtml } from '/shared/js/dom.js';

async function init() {
  await bootStaticPage();

  const form = qs('#contact-form');
  if (!form) return;

  const notice = qs('#contact-notice');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const payload = Object.fromEntries(new FormData(form).entries());

    if (!payload.name?.trim() || !payload.email?.trim() || !payload.message?.trim()) {
      notice.hidden = false;
      notice.className = 'notice notice--error';
      notice.textContent = 'Please complete your name, email and message.';
      return;
    }

    setBusy(button, true, 'Sending…');
    try {
      await apiFetch('/api/contact', { method: 'POST', body: payload });
      form.reset();
      notice.hidden = false;
      notice.className = 'notice notice--success';
      notice.textContent =
        'Thank you — your message has been received. We will reply by email as soon as we can.';
      notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      notice.hidden = false;
      notice.className = 'notice notice--error';
      notice.textContent = escapeHtml(error.message);
    } finally {
      setBusy(button, false);
    }
  });
}

init().catch((error) => console.error('[contact]', error));
