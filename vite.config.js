import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Local dev middleware that replicates api/webdav-proxy.js so VITE_WEBDAV_PROXY_URL
// can point to /api/webdav-proxy without a running Vercel dev server.
function webdavProxyPlugin() {
  return {
    name: 'webdav-proxy',
    configureServer(server) {
      server.middlewares.use('/api/webdav-proxy', async (req, res) => {
        const target = req.headers['x-webdav-url']
        if (!target) { res.writeHead(400); res.end('Missing X-WebDAV-Url'); return }
        const headers = {}
        for (const h of ['authorization', 'x-webdav-auth', 'content-type', 'if-match', 'depth', 'destination']) {
          if (req.headers[h]) headers[h] = req.headers[h]
        }
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = chunks.length ? Buffer.concat(chunks) : undefined
        try {
          const upstream = await fetch(target, { method: req.method, headers, body })
          const resHeaders = {}
          for (const h of ['content-type', 'etag', 'last-modified', 'dav', 'allow']) {
            const v = upstream.headers.get(h)
            if (v) resHeaders[h] = v
          }
          res.writeHead(upstream.status, resHeaders)
          res.end(Buffer.from(await upstream.arrayBuffer()))
        } catch (err) {
          res.writeHead(502); res.end(err.message)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    webdavProxyPlugin(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon-*.png', 'maskable-icon-*.png'],
      manifest: false,          // we ship our own public/manifest.json
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Cache Google Fonts so the app works offline
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  base: '/',
  test: {
    environment: 'node',
  },
})
