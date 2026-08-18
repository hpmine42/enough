import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { enoughPwa } from './scripts/pwa-plugin';

export default defineConfig({
  plugins: [react(), enoughPwa()],
  // GitHub Pages serves this project at /enough/, so the built asset URLs
  // must be prefixed accordingly. Vite does NOT read VITE_BASE automatically;
  // it only reads the `base` option (or --base). The deploy workflow sets
  // VITE_BASE=/enough/; default to '/' for local dev / root deployments.
  base: process.env.VITE_BASE ?? '/',
  server: {
    host: true,
    port: 5173,
    // Allow the Arena preview host (dynamic *.e2b.app) in development.
    allowedHosts: true,
  },
});
