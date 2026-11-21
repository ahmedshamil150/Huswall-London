import { apiFetch } from '/shared/js/api.js';

/**
 * Admin API wrapper. The shared apiFetch attaches the Supabase access token;
 * every /api/admin endpoint re-checks the admin role server-side.
 */
export async function adminApi(path, { method = 'GET', body } = {}) {
  try {
    return await apiFetch(`/api/admin${path}`, { method, body });
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) {
      window.dispatchEvent(new CustomEvent('admin:unauthorised', { detail: error }));
    }
    throw error;
  }
}

export function publicApi(path, { method = 'GET', body } = {}) {
  return apiFetch(path, { method, body });
}
