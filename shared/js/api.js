import { supabase } from './supabase.js';

/**
 * Thin fetch wrapper for /api endpoints. Attaches the current Supabase access
 * token when a session exists so serverless functions can authorise the caller.
 */
export async function apiFetch(path, { method = 'GET', body, headers = {}, idempotencyKey } = {}) {
  const finalHeaders = { 'Content-Type': 'application/json', ...headers };

  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) {
      finalHeaders.Authorization = `Bearer ${data.session.access_token}`;
    }
  }
  if (idempotencyKey) finalHeaders['Idempotency-Key'] = idempotencyKey;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw Object.assign(new Error('We could not reach the server. Check your connection and try again.'), {
      code: 'NETWORK_ERROR',
      status: 0
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Request failed (${response.status}).`);
    error.code = payload?.error?.code || 'REQUEST_FAILED';
    error.status = response.status;
    error.details = payload?.error?.details;
    throw error;
  }

  return payload;
}
