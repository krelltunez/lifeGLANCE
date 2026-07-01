// Native-safe (url, init) => Response adapter for GLANCEvault HTTP.
//
// The package vault client (createVaultClient.doFetch) and the blob transport
// both issue requests with the standard `fetch(url, init)` signature and read
// `.ok / .status / .json() / .text()` (the blob transport also `.arrayBuffer()`)
// off the result. On a native Capacitor WebView, the default `globalThis.fetch`
// to the cross-origin vault is CORS-blocked, so this routes the same call through
// CapacitorHttp and synthesizes a Response.
//
// BINARY (Phase 8 blob media): CapacitorHttp does NOT accept a raw Uint8Array
// body — a typed array serialises to `{"0":..}` via its JSON path, corrupting or
// rejecting the request (this broke blob part-uploads on native). The plugin's
// binary contract, verified against @capacitor/android Capacitor 8:
//   • REQUEST binary  → `data` = base64 string + `dataType: 'file'`; the native
//     side base64-DECODES it and writes raw bytes (CapacitorHttpUrlConnection).
//   • RESPONSE binary → `responseType: 'arraybuffer'`; `res.data` comes back as a
//     base64 string (readStreamAsBase64), so it must be base64-DECODED here.
// Text/JSON control-plane calls keep `responseType: 'text'` (res.data is a
// string) exactly as before. An ERROR response body is always a plain string
// even under 'arraybuffer', so we only base64-decode on a 2xx binary read.
//
// Web is untouched: nativeVaultFetchImpl() returns undefined off-native, so
// callers fall back to global fetch (the vault serves CORS in a browser).

import { CapacitorHttp } from '@capacitor/core'
import { isNativePlatform } from './nativeHttp.js'

// ── base64 <-> bytes (chunked; avoids spread-arg overflow on large blobs) ────
function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
function base64ToBytes(b64) {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const etagOf = (headers) => {
  if (!headers) return null
  for (const k of Object.keys(headers)) if (k.toLowerCase() === 'etag') return headers[k]
  return null
}

// Default native primitive: the real CapacitorHttp.request. Injectable so tests
// exercise the base64 encode/decode + Response mapping with a fake, never the
// (device-only) plugin.
const defaultNativeHttp = (opts) => CapacitorHttp.request(opts)

/**
 * Build a fetch-shaped adapter over a CapacitorHttp-shaped request primitive.
 * `httpRequest(opts)` takes `{ url, method, headers, data?, dataType?, responseType }`
 * and resolves `{ status, data, headers }` (the CapacitorHttp response shape).
 */
export function makeNativeVaultFetch(httpRequest = defaultNativeHttp) {
  return async (url, init = {}) => {
    const method = init.method || 'GET'
    const headers = init.headers || {}
    const wantBinary = init.responseType === 'arraybuffer'

    const opts = { url, method, headers, responseType: wantBinary ? 'arraybuffer' : 'text' }
    const body = init.body
    if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
      // Binary request body → base64 + dataType 'file' so native writes raw bytes.
      opts.data = bytesToBase64(body instanceof Uint8Array ? body : new Uint8Array(body))
      opts.dataType = 'file'
    } else if (body != null) {
      opts.data = body // string (JSON etc.) — native writes it as UTF-8
    }

    const res = await httpRequest(opts)
    const status = res.status
    const ok = status >= 200 && status < 300

    // Binary success → res.data is base64 of the raw bytes. Text responses, and
    // ANY error body (native reads the error stream as a plain string even under
    // 'arraybuffer'), come back as a plain string.
    let bytes = null
    let text = ''
    if (wantBinary && ok && typeof res.data === 'string') {
      bytes = base64ToBytes(res.data)
    } else if (typeof res.data === 'string') {
      text = res.data
    } else if (res.data != null) {
      text = JSON.stringify(res.data) // native may auto-parse JSON; re-stringify to parse below
    }

    return {
      ok,
      status,
      statusText: '',
      headers: { get: (n) => (String(n).toLowerCase() === 'etag' ? (etagOf(res.headers) ?? null) : null) },
      text: async () => (bytes ? new TextDecoder().decode(bytes) : text),
      json: async () => JSON.parse(bytes ? new TextDecoder().decode(bytes) : text),
      arrayBuffer: async () => (bytes ? bytes.buffer : new TextEncoder().encode(text).buffer),
    }
  }
}

// undefined on web (callers keep global fetch), the native adapter on native.
export const nativeVaultFetchImpl = () => (isNativePlatform() ? makeNativeVaultFetch() : undefined)
