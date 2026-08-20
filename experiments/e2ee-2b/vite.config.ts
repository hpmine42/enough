import { defineConfig } from 'vite';

export default defineConfig({
  base: '/enough/',
  build: { target: 'es2022', sourcemap: false },
  preview: { host: true, allowedHosts: true },
});
