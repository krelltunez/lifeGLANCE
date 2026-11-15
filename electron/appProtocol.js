// The app:// protocol the packaged renderer is served from (docs/desktop-app.md,
// "Origin and storage"). After lastGLANCE's electron/appProtocol.ts, itself
// dayGLANCE's.
//
// The renderer loads from a registered standard+secure scheme rather than
// file://, whose opaque `null` origin can be neither allowlisted nor kept
// stable. lifeGLANCE ships on this origin from its first desktop build and must
// never leave it: IndexedDB (the whole timeline) and localStorage are
// partitioned by origin, so a move would orphan them.
//
// EXACT ORIGIN produced: `app://lifeglance` (scheme `app`, host `lifeglance`).
// Not `null`, and no trailing slash. A GLANCEvault server that restricts its
// CORS origins allows THIS.
//
// Only the pure request -> file mapping lives here, so it is tested without
// Electron. main.js wires it into protocol.handle and supplies the file reads.

import path from 'node:path'

export const APP_SCHEME = 'app'
export const APP_HOST = 'lifeglance'
/** The renderer's origin (no trailing slash). */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
/** The URL the window loads. */
export const APP_BASE_URL = `${APP_ORIGIN}/`

// The asset kinds a Vite build emits. A wrong or missing type on the entry
// module script means Chromium refuses to run it, so js/css/html must be exact.
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

export function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

/**
 * Map an app:// request URL to a file under distDir.
 *
 *  - `/` (or empty) is index.html.
 *  - An existing file is served with its content type.
 *  - Anything else is a 404. The app has no client-side routes, so there is no
 *    fallback to index.html: a request that should have gone somewhere else
 *    (a missing asset, a relative API path) fails as itself rather than
 *    answering 200 with the app's HTML.
 *  - A path that leaves distDir is a 403.
 *
 * `isFile` is injected (fs.statSync in main, a fake set in tests). The query
 * string is ignored.
 *
 * @param {string} distDir
 * @param {string} requestUrl
 * @param {(p: string) => boolean} isFile
 * @returns {{ status: 200 | 403 | 404, filePath?: string, contentType?: string }}
 */
export function resolveAppRequest(distDir, requestUrl, isFile) {
  let pathname
  try {
    const url = new URL(requestUrl)
    if (url.host !== APP_HOST) return { status: 404 }
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return { status: 404 }
  }

  const distRoot = path.resolve(distDir)
  if (pathname === '/' || pathname === '') {
    return { status: 200, filePath: path.join(distRoot, 'index.html'), contentType: CONTENT_TYPES['.html'] }
  }

  const full = path.resolve(distRoot, pathname.replace(/^\/+/, ''))
  if (full !== distRoot && !full.startsWith(distRoot + path.sep)) return { status: 403 }
  if (!isFile(full)) return { status: 404 }
  return { status: 200, filePath: full, contentType: contentTypeFor(full) }
}
