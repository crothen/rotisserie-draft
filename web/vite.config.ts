import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // /api/* is served by Firebase Hosting rewrites in production;
    // in dev, proxy to the hosting emulator so apiPost() works as-is.
    proxy: {
      '/api': 'http://127.0.0.1:5000',
    },
  },
});
