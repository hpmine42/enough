// Test-only Supabase stub.
//
// `api.ts` imports `supabase` from './supabase'. In the Node test runner there
// is no Vite config and no Supabase credentials, so the real module exports
// `null`. To exercise the real api.ts logic we need a controllable client:
// this module supplies a live `supabase` binding plus a setter, and the test
// loader redirects `src/lib/supabase.ts` to this file.
export let supabase = null;

/** Replace the global supabase binding with a test double */
export function __setSupabase(client) {
  supabase = client;
}
