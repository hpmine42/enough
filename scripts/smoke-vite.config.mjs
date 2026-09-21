// Test-only instrumentation: expose the real client to the release-blocker
// harness so it can retain and deliver already-queued realtime callbacks.
// App/Chat and the crypto engine still run unchanged. Never used by build or
// deploy, and only enabled for the isolated blocker smoke subprocess.
import { mergeConfig } from 'vite';
import config from '../vite.config.ts';

export default mergeConfig(config, {
  plugins: process.env.SMOKE_RELEASE_BLOCKERS ? [{
    name: 'smoke-client-observer',
    transform(code, id) {
      if (!id.endsWith('/src/lib/supabase.ts')) return;
      return { code: `${code}\nglobalThis.__enoughSmokeSupabase = supabase;`, map: null };
    },
  }] : [],
});
