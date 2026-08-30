// Test-runner ESM loader for the enough. app.
//
// The app is built with Vite and uses bundler-style extensionless imports that
// Node's ESM resolver rejects. This loader teaches Node to resolve those, and
// redirects the real `supabase` client module to a test stub so tests can drive
// api.ts with a controllable fake (no Supabase credentials required).
//
// Load with: node --import ./scripts/load-enough-ts.mjs
const supabaseUrl = new URL('../src/lib/supabase.ts', import.meta.url).href;
const mockUrl = new URL('../src/lib/__tests__/supabase-mock.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  let resolved;
  let originalError;
  try {
    resolved = await nextResolve(specifier, context);
  } catch (err) {
    originalError = err;
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      for (const candidate of [specifier + '.ts', specifier]) {
        try {
          resolved = await nextResolve(candidate, context);
          break;
        } catch {
          /* keep trying */
        }
      }
      if (!resolved) {
        try {
          resolved = await nextResolve(specifier + '/index.ts', context);
        } catch {
          /* keep original error */
        }
      }
    }
    if (!resolved) throw originalError;
  }

  // Redirect the real supabase module to the test stub so api.ts uses a fake.
  if (resolved.url === supabaseUrl) {
    return { url: mockUrl, shortCircuit: true };
  }
  return resolved;
}
