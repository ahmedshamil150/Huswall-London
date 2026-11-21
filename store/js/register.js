import { initLayout } from '/shared/js/layout.js';
import { supabase } from '/shared/js/supabase.js';
import { signUp } from '/shared/js/auth.js';
import { setMeta } from '/shared/js/seo.js';
import { qs, setBusy } from '/shared/js/dom.js';

function showError(message) {
  const box = qs('#auth-error');
  box.textContent = message;
  box.hidden = false;
}

async function init() {
  await initLayout();
  setMeta({ title: 'Create an Account | Hasswell London', noindex: true, path: '/register' });

  if (!supabase) {
    showError('Authentication is not configured. Add the Supabase environment variables first.');
    return;
  }

  const { data } = await supabase.auth.getSession();
  if (data.session) {
    window.location.replace('/account');
    return;
  }

  qs('#register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    qs('#auth-error').hidden = true;
    const button = event.target.querySelector('button[type="submit"]');

    const fullName = qs('#full_name').value.trim();
    const email = qs('#email').value.trim();
    const password = qs('#password').value;
    const confirm = qs('#password_confirm').value;

    if (!fullName || !email) {
      showError('Enter your name and email address.');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      showError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      showError('Use a password of at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      showError('The passwords do not match.');
      return;
    }
    if (!qs('#terms').checked) {
      showError('Please accept the terms to create an account.');
      return;
    }

    setBusy(button, true, 'Creating account…');
    try {
      const result = await signUp({ email, password, fullName });
      if (result.session) {
        window.location.assign('/account');
        return;
      }
      const notice = qs('#auth-notice');
      notice.textContent =
        'Check your inbox to confirm your email address, then sign in. If it does not arrive within a few minutes, check your spam folder.';
      notice.hidden = false;
      event.target.hidden = true;
    } catch (error) {
      showError(
        error.message.toLowerCase().includes('already')
          ? 'An account with that email already exists. Try signing in instead.'
          : error.message
      );
    } finally {
      setBusy(button, false);
    }
  });
}

init().catch((error) => console.error('[register]', error));
