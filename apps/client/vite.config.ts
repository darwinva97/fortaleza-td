import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // El backend de dev es el MISMO worker de Cloudflare que desplegamos
    // (wrangler dev en :8787, vía `pnpm dev` o `pnpm cf:dev`). El server Node
    // se eliminó del repo: solo Cloudflare.
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': { target: 'http://localhost:8787' },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
