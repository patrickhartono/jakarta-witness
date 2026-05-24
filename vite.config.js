import { defineConfig } from 'vite';

// Served at https://jakarta-witness.com via a custom apex domain on
// GitHub Pages (CNAME in public/), so the production base path is root.
export default defineConfig(() => ({
  base: '/',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2000,
  },
  // onnxruntime-web ships prebuilt wasm/mjs assets that Vite's dep optimizer
  // mishandles; exclude it so the runtime loads its own assets from the CDN.
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
}));
