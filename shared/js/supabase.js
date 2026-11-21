import { createClient } from '@supabase/supabase-js';
import { config, isSupabaseConfigured } from './config.js';

/**
 * Single browser Supabase client. The anon key is public by design; access is
 * controlled by Row Level Security policies in supabase/migrations.
 */
export const supabase = isSupabaseConfigured
  ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
      },
      global: {
        headers: { 'x-client-info': 'hasswell-storefront' }
      }
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment.'
    );
  }
  return supabase;
}
