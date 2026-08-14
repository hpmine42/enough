import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Allow the Arena preview host (dynamic *.e2b.app) in development.
    allowedHosts: true,
  },
});
