import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// Cross-origin isolation enables SharedArrayBuffer, so onnxruntime-web runs the reranker on several WASM
// threads (~2 s instead of ~7 s for 20 passages). Vercel sends the same headers (vercel.json).
const CROSS_ORIGIN_ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/app', import.meta.url)) } },
  // PGlite ships its own wasm/data assets; pre-bundling breaks their URLs.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
  server: { proxy: { '/api': 'http://localhost:8787' }, headers: CROSS_ORIGIN_ISOLATION },
  preview: { headers: CROSS_ORIGIN_ISOLATION },
});
