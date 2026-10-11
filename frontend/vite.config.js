import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.VITE_DEV_BACKEND || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Same-origin in dev, so no CORS and the socket handshake works through the proxy
    proxy: {
      '/api': backend,
      '/socket.io': { target: backend, ws: true }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: false
  }
});
