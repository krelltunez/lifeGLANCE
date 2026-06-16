// Native WebDAV transport for Capacitor (iOS + Android) shells.
//
// A native WebView enforces CORS exactly like a browser, and lifeGLANCE's sync
// was built around a server-side CORS proxy whose URL resolves to localhost
// inside the shell. So on native we bypass the proxy entirely and hit the
// WebDAV server directly through the native HTTP stack via CapacitorHttp.
//
// CapacitorHttp.request() is called directly (no global fetch patch), so the
// browser/PWA build is untouched — every caller gates on isNativePlatform().

import { Capacitor, CapacitorHttp } from '@capacitor/core'

export const isNativePlatform = () => Capacitor.isNativePlatform()

// Case-insensitive header lookup (native header casing varies by platform).
function headerGet(headers, name) {
  if (!headers) return null
  const lower = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key]
  }
  return null
}

// Low-level direct request. Returns a normalized result the adapters reshape.
async function nativeRequest(method, url, headers, body) {
  const res = await CapacitorHttp.request({
    method,
    url,
    headers,
    data: body ?? undefined,
    responseType: 'text',
  })
  const bodyText =
    typeof res.data === 'string' ? res.data
      : res.data == null ? ''
        : JSON.stringify(res.data)
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    etag: headerGet(res.headers, 'etag'),
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
