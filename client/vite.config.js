import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser only ever talks to /api on this origin. Vite proxies it to Express,
// so no backend URL, key or secret is ever bundled into frontend code.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': process.env.VITE_PROXY_TARGET || 'http://localhost:4000' } },
});
