import { supabase } from './supabase.js';

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

/**
 * Fetch the caller's profile. Role is protected by RLS: a customer can read
 * their own row but cannot change it to 'admin'.
 */
export async function getProfile() {
  const user = await getUser();
  if (!user || !supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, phone, role, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    console.warn('[auth] profile load failed:', error.message);
    return null;
  }
  return data;
}

export async function isAdmin() {
  const profile = await getProfile();
  return Boolean(profile && profile.role === 'admin' && profile.is_active);
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp({ email, password, fullName }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${window.location.origin}/account`
    }
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/**
 * Redirects to login when no session exists. Returns the user or null.
 */
export async function requireAuth(redirectTo = window.location.pathname + window.location.search) {
  const user = await getUser();
  if (!user) {
    window.location.replace(`/login?next=${encodeURIComponent(redirectTo)}`);
    return null;
  }
  return user;
}

/** Only render admin UI when the profile carries the admin role. */
export async function requireAdmin() {
  const user = await getUser();
  if (!user) {
    window.location.replace('/admin/login');
    return null;
  }
  const profile = await getProfile();
  if (!profile || profile.role !== 'admin' || !profile.is_active) {
    window.location.replace('/admin/login?error=forbidden');
    return null;
  }
  return { user, profile };
}
