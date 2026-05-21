import { defineConfig } from 'vite';

// GitHub Pages serves this project at https://patrickhartono.github.io/jakarta-witness/
// so the production build needs the repo name as base path. Local dev stays at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/jakarta-witness/' : '/',
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
