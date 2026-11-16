import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Local dev middleware that replicates api/webdav-proxy.js so VITE_WEBDAV_PROXY_URL
// can point to /api/webdav-proxy without a running Vercel dev server.
function webdavProxyPlugin() {
  return {
    name: 'webdav-proxy',
    configureServer(server) {
      server.middlewares.use('/api/webdav-proxy', async (req, res) => {
        // @glance-apps/sync uses ?url= query param; intents transport uses X-WebDAV-Url header
        const qs = new URL(req.url, 'http://localhost').searchParams
        const target = qs.get('url') || req.headers['x-webdav-url']
        if (!target) { res.writeHead(400); res.end('Missing target URL'); return }
        const headers = {}
        for (const h of ['authorization', 'content-type', 'if-match', 'if-none-match', 'depth', 'destination']) {
          if (req.headers[h]) headers[h] = req.headers[h]
        }
        if (req.headers['x-webdav-auth']) headers['authorization'] = req.headers['x-webdav-auth']
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = chunks.length ? Buffer.concat(chunks) : undefined
        try {
          const upstream = await fetch(target, { method: req.method, headers, body })
          const resHeaders = {}
          for (const h of ['content-type', 'etag', 'last-modified', 'dav', 'allow', 'if-match', 'if-none-match']) {
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

// The typeface. The web build links Courier Prime from Google Fonts in
// index.html (cached offline by the service worker). The desktop app has no
// service worker and must open with no network, so its build carries the font
// files instead: the Google links are taken out of index.html, and
// `virtual:app-fonts` (imported by src/main.jsx) becomes the @font-face rules
// of @fontsource/courier-prime, whose woff2 files Vite then bundles. In every
// other build that module is empty and nothing is added.
function appFontsPlugin(bundled) {
  const VIRTUAL = 'virtual:app-fonts'
  const RESOLVED = '\0' + VIRTUAL
  const faces = ['400', '400-italic', '700', '700-italic']
  return {
    name: 'app-fonts',
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null
      return bundled ? faces.map((f) => `import '@fontsource/courier-prime/${f}.css'`).join('\n') : 'export {}'
    },
    transformIndexHtml(html) {
      if (!bundled) return html
      const stripped = html.replace(/\s*<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '')
      if (stripped === html) throw new Error('app-fonts: index.html no longer links Google Fonts; update this plugin')
      return stripped
    },
  }
}

// `--mode electron` is the desktop app's renderer (docs/desktop-app.md): the
// same bundle with no PWA. The desktop shell serves the files itself and
// replaces them whole on an update, so a service worker there could only serve
// a stale bundle. It also bundles the typeface (appFontsPlugin). Everything
// else, including the root base path app://lifeglance serves from, is shared.
export default defineConfig(({ mode }) => ({
  // Captured at build time (and at dev-server start) so the help modal can show
  // when this bundle was built rather than the current wall-clock time.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    // The app version, for the writer stamp every sync write carries
    // (src/sync/writerStamp.js).
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    webdavProxyPlugin(),
    react(),
    appFontsPlugin(mode === 'electron'),
    mode !== 'electron' && VitePWA({
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
  build: {
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            {
              // Translations load lazily (see src/locales.js); group each
              // language's 13 namespace files into one chunk per language
              // rather than 13 fragments each, so a language is one small
              // precache entry. en is left out: i18n.js imports it eagerly as
              // the synchronous fallback, so it belongs in the main chunk.
              name: (id) => {
                const lng = id.match(/src\/locales\/([^/]+)\//)?.[1]
                return lng && lng !== 'en' ? `locale-${lng}` : undefined
              },
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
  },
}))
