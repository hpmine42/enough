import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { version } from './package.json';
import { enoughPwa } from './scripts/pwa-plugin';

export default defineConfig({
  plugins: [react(), enoughPwa()],
  // Inject the package version at build time so the Settings footer cannot
  // drift from package.json (audit P3-1). Declared in src/vite-env.d.ts.
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  // GitHub Pages serves this project at /enough/, so the built asset URLs
  // must be prefixed accordingly. Vite does NOT read VITE_BASE automatically;
  // it only reads the `base` option (or --base). The deploy workflow sets
  // VITE_BASE=/enough/; default to '/' for local dev / root deployments.
  base: process.env.VITE_BASE ?? '/',
  build: {
    // Manual chunk splitting keeps the initial chunk under 500 KB:
    //   - react-vendor     : React + ReactDOM (~45 KB gz)
    //   - supabase-vendor  : @supabase/supabase-js (~47 KB gz)
    //   - signal-wasm      : the @getmaapp/signal-wasm engine entry (the
    //                        WASM binary is a separate emitted asset)
    //   - ui               : Settings/Chat/Home route components (used by
    //                        lazy-loaded routes in #11)
    // Anything else lands in the main app chunk.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react/') || id.includes('react-dom/')) {
            return 'react-vendor';
          }
          if (id.includes('@supabase/')) {
            return 'supabase-vendor';
          }
          if (id.includes('@getmaapp/signal-wasm')) {
            return 'signal-wasm';
          }
          return 'vendor';
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    // Allow the Arena preview host (dynamic *.e2b.app) in development.
    allowedHosts: true,
  },
});
