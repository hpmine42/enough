import { createClient, SupabaseClient } from '@supabase/supabase-js';

// `import.meta.env` is a Vite provision; guard it so this module does not
// crash on import in non-Vite runtimes (e.g. the Node test runner loading the
// e2ee layer). In the browser/Vite, import.meta.env is always defined.
const env = (import.meta.env ?? {}) as Record<string, string | undefined>;

const url = env.VITE_SUPABASE_URL as string | undefined;
const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const isSupabaseConfigured: boolean = Boolean(url && key);

// Supabase can return either a PKCE `?code=…` callback or an implicit
// `#access_token=…&type=recovery` callback, depending on the project's email
// template and auth configuration. A PKCE-only client rejects the latter
// before it can emit PASSWORD_RECOVERY. Inspect parameter names only (never
// values) so both valid callback formats are delegated to Supabase Auth.
const implicitCallback = (() => {
  if (typeof window === 'undefined') return { present: false, recovery: false };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const present = hash.has('access_token') && hash.has('refresh_token');
  return { present, recovery: present && hash.get('type') === 'recovery' };
})();

// Captured before Supabase intentionally removes token parameters from the URL.
// AuthProvider combines this marker with a successfully restored session, which
// also covers the narrow race where PASSWORD_RECOVERY fires before React's
// listener has mounted.
export const hasImplicitRecoveryCallback = implicitCallback.recovery;

function callbackFlow(): 'pkce' | 'implicit' {
  return implicitCallback.present ? 'implicit' : 'pkce';
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, key as string, {
      auth: {
        flowType: callbackFlow(),
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
