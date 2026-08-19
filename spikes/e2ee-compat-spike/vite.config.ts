import { defineConfig } from 'vite';

// Mirrors the production app configuration (see /vite.config.ts):
// - GitHub Pages serves at /enough/, so base is fixed here (the real app
//   sets it via VITE_BASE in the deploy workflow).
// - No React needed: this spike only exercises crypto libraries.
export default defineConfig({
  base: '/enough/',
  build: {
    // Emit readable sizes for the feasibility report.
    sourcemap: false,
    target: 'es2022',
  },
  preview: {
    host: true,
    // Allow the dynamic Arena/e2b preview host so the spike page can be
    // opened in a real browser for verification.
    allowedHosts: true,
  },
});
