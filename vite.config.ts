import { defineConfig } from 'vite';

// base: './' keeps the production build portable (any static host or sub-folder).
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
});
