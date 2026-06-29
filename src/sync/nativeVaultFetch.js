// Native-safe (url, init) => Response adapter for GLANCEvault HTTP.
//
// The package vault client (createVaultClient.doFetch) and the blob transport
// both issue requests with the standard `fetch(url, init)` signature and read
// `.ok / .status / .json() / .text()` (the blob transport also `.arrayBuffer()`)
// off the result. On a native Capacitor WebView, the default `globalThis.fetch`
// to the cross-origin vault is blocked by CORS — which is why the verify probe,
// vault sync, and blob upload/download all fail on native.
//
// This adapter routes that same `(url, init)` call through lifeGLANCE's existing
// native HTTP primitive (CapacitorHttp, via nativeRequest) and synthesizes a
// minimal Response so callers don't know the difference — the same shape
// lastGLANCE's vaultFetchImpl uses. It is the EXPLICIT half of the fix; the
// other half is the global CapacitorHttp patch in capacitor.config.ts, which
// covers the engine's internal vault client that we don't inject into.
//
// Web is untouched: nativeVaultFetchImpl() returns undefined off-native, so
// every injection site falls back to global fetch (the vault serves CORS in a
// browser, so plain fetch is correct there).

import { isNativePlatform, nativeRequest } from './nativeHttp.js'

/**
 * Build a fetch-shaped adapter over a native request primitive.
 *
 * @param {(method:string,url:string,headers:object,body:any)=>Promise<{status:number,ok:boolean,etag:string|null,body:string}>} [requestFn]
 *   lifeGLANCE's native primitive (defaults to nativeRequest). It returns the raw
 *   response body as a STRING (responseType 'text'), so .json()/.text() parse.
 * @returns {(url:string, init?:object)=>Promise<object>} a Response-like fetcher.
 */
export function makeNativeVaultFetch(requestFn = nativeRequest) {
  return async (url, init = {}) => {
    const r = await requestFn(init.method || 'GET', url, init.headers || {}, init.body)
    const body = typeof r.body === 'string' ? r.body : (r.body == null ? '' : String(r.body))
    return {
      ok: r.ok ?? (r.status >= 200 && r.status < 300),
      status: r.status,
      statusText: '',
      headers: { get: (name) => (String(name).toLowerCase() === 'etag' ? (r.etag ?? null) : null) },
      json: async () => JSON.parse(body),
      text: async () => body,
      // Control-plane responses are text/JSON; this covers them. True binary blob
      // bytes (Range / arrayBuffer downloads) over CapacitorHttp are the Phase 8
      // media follow-up flagged in blobTransport.ts — not wired here.
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    }
  }
}

// undefined on web (callers keep global fetch), the native adapter on native.
export const nativeVaultFetchImpl = () => (isNativePlatform() ? makeNativeVaultFetch() : undefined)
