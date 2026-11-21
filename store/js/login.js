import { initLayout } from '/shared/js/layout.js';
import { supabase } from '/shared/js/supabase.js';
import { setMeta } from '/shared/js/seo.js';
import { getUser, getProfile } from '/shared/js/auth.js';
import { qs, setBusy } from '/shared/js/dom.js';

function nextUrl() {
  const next = new URLSearchParams(window.location.search).get('next');
  if (!next) return '/account';
  // Only allow same-origin relative paths to prevent open redirects.
  if (!next.startsWith('/') || next.startsWith('//')) return '/account';
  return next;
}

function showError(message) {
  const box = qs('#auth-error');
  box.textContent = message;
  box.hidden = false;
}

function showNotice(message) {
  const box = qs('#auth-notice');
  box.textContent = message;
  box.hidden = false;
}

async function init() {
  await initLayout();
  setMeta({ title: 'Sign In | Hasswell London', noindex: true, path: '/login' });

  if (!supabase) {
    showError('Authentication is not configured. Add the Supabase environment variables first.');
    return;
  }

  const existing = await getUser();
  if (existing) {
    const profile = await getProfile();
    window.location.replace(profile?.role === 'admin' && nextUrl().startsWith('/admin') ? nextUrl() : '/account');
    return;
  }

  if (new URLSearchParams(window.location.search).get('error') === 'forbidden') {
    showError('That account does not have administrator access.');
  }

  qs('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    const email = qs('#email').value.trim();
    const password = qs('#password').value;
    qs('#auth-error').hidden = true;

    if (!email || !password) {
      showError('Enter your email address and password.');
      return;
    }

    setBusy(button, true, 'Signing in…');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(button, false);

    if (error) {
      showError(
        error.message.toLowerCase().includes('invalid')
          ? 'That email and password combination was not recognised.'
          : error.message
      );
      return;
    }

    window.location.assign(nextUrl());
  });

  qs('#forgot-toggle').addEventListener('click', () => {
    const form = qs('#reset-form');
    form.hidden = !form.hidden;
    if (!form.hidden) qs('#reset-email').value = qs('#email').value;
  });

  qs('#reset-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    const email = qs('#reset-email').value.trim();
    if (!email) return;

    setBusy(button, true, 'Sending…');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/account?recovery=1`
    });
    setBusy(button, false);

    if (error) {
      showError(error.message);
      return;
    }
    showNotice('If that email is registered, a reset link is on its way. Check your inbox and spam folder.');
  });
}

init().catch((error) => console.error('[login]', error));
