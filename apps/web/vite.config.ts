import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { canonicalPublicUrl } from './src/origin.ts';

const publicHost = process.env.DEV_PUBLIC_HOST?.trim();
const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN) : undefined;
const proxyHeaders = publicOrigin?.protocol === 'https:'
  ? { 'x-forwarded-proto': 'https', 'x-forwarded-host': publicOrigin.host }
  : undefined;

export default defineConfig({
  plugins: [{
    name: 'canonical-public-origin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const redirect = canonicalPublicUrl(req.headers.host, req.url ?? '/', publicOrigin);
        if (!redirect) { next(); return; }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 403;
          res.end('Use the configured HTTPS application origin.');
          return;
        }
        res.statusCode = 307;
        res.setHeader('Location', redirect);
        res.end();
      });
    }
  }, react(), tailwindcss()],
  server: {
    allowedHosts: publicHost ? [publicHost] : [],
    proxy: Object.fromEntries(['/api', '/admin', '/health'].map((path) => [path, {
      target: 'http://localhost:4000',
      changeOrigin: false,
      xfwd: true,
      headers: proxyHeaders
    }]))
  },
  build: { sourcemap: true }
});
