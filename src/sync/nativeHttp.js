// Native WebDAV transport for Capacitor (iOS + Android) shells.
//
// A native WebView enforces CORS exactly like a browser, and lifeGLANCE's sync
// was built around a server-side CORS proxy whose URL resolves to localhost
// inside the shell. So on native we bypass the proxy entirely and hit the
// WebDAV server directly through the native HTTP stack.
//
// Two Android-specific hazards are handled here (both also fixed engine-side in
// @glance-apps/sync 1.6.1, but the transport is where they originate):
//
//  1. Non-core verbs. WebDAV needs PROPFIND (listing / connection test) and
//     MKCOL (folder creation). CapacitorHttp's Android backend is
//     HttpURLConnection, whose setRequestMethod() throws ProtocolException
//     ("Invalid HTTP method: PROPFIND") for anything outside the HTTP/1.1 core
//     set. So those verbs are routed through a small OkHttp-backed plugin
//     (WebDavHttp) on Android, which accepts any method. iOS's URLSession
//     already accepts arbitrary verbs, so iOS stays on CapacitorHttp. This fixes
//     the sync engine's own PROPFIND/MKCOL (issued via electronProxyFetch) and
//     the app's calls alike (lastGLANCE issue #233).
//
//  2. ETag mangling. HttpURLConnection requests gzip implicitly; Apache
//     mod_deflate then rewrites the ETag to "xyz-gzip" (nginx downgrades strong
//     ETags to weak, W/"xyz"), which breaks If-Match and wedges file sync in a
//     permanent 412 loop (issue #232). We send Accept-Encoding: identity to stop
//     the mangling at the source, and normalize any validator that still slips
//     through with the engine's exported helper.
//
// Every caller gates on isNativePlatform(), so the browser/PWA build is untouched.

import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'
import { normalizeEtag } from '@glance-apps/sync'

export const isNativePlatform = () => Capacitor.isNativePlatform()

// OkHttp-backed transport for WebDAV verbs HttpURLConnection rejects.
const WebDavHttp = registerPlugin('WebDavHttp')

// Verbs HttpURLConnection (hence CapacitorHttp) accepts. Anything else must go
// through OkHttp on Android.
const CORE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'])
function needsOkHttp(method) {
  return Capacitor.getPlatform() === 'android' && !CORE_METHODS.has(String(method).toUpperCase())
}

// Case-insensitive header lookup (native header casing varies by platform:
// "ETag", "Etag", or lowercase "etag" over HTTP/2).
function headerGet(headers, name) {
  if (!headers) return null
  const lower = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key]
  }
  return null
}

// Low-level direct request. Returns a normalized result the adapters reshape.
// Exported so the vault fetch adapter (nativeVaultFetch.js) can reuse the same
// primitive the WebDAV/intents transports use.
export async function nativeRequest(method, url, headers, body) {
  // Force an unencoded response so a content-coding filter can't mangle the
  // ETag. Callers may override by passing their own Accept-Encoding.
  const reqHeaders = { 'Accept-Encoding': 'identity', ...headers }

  const res = needsOkHttp(method)
    ? await WebDavHttp.request({ method, url, headers: reqHeaders, data: body ?? '' })
    : await CapacitorHttp.request({ method, url, headers: reqHeaders, data: body ?? undefined, responseType: 'text' })

  const bodyText =
    typeof res.data === 'string' ? res.data
      : res.data == null ? ''
        : JSON.stringify(res.data)
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    // Strip any W/ prefix or -gzip/-br suffix that survived, so the engine's
    // If-Match round-trips the entity's real validator (the engine also
    // normalizes on its download path; this is idempotent belt-and-suspenders).
    etag: normalizeEtag(headerGet(res.headers, 'etag')),
    body: bodyText,
  }
}

// Adapter matching the @glance-apps/sync `electronProxyFetch` contract:
//   (method, url, headers, body) -> { status, ok, statusText, headers: { etag }, body }
export async function nativeWebdavFetch(method, url, headers, body) {
  const r = await nativeRequest(method, url, headers, body)
  return { status: r.status, ok: r.ok, statusText: '', headers: { etag: r.etag }, body: r.body }
}

// Adapter shaped like a fetch Response for the intents transport, which uses
// res.ok / res.status / res.text() / res.json().
export async function nativeWebdavResponse(method, url, headers, body) {
  const r = await nativeRequest(method, url, headers, body)
  return {
    ok: r.ok,
    status: r.status,
    statusText: '',
    text: async () => r.body,
    json: async () => JSON.parse(r.body),
  }
}
