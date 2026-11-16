// The page's HTTP, made by the main process (docs/desktop-app.md, "Sync through
// the main process"). The page's CSP allows it no request to a sync server of
// its own; WebDAV, GLANCEvault and intents all come through here, so no server
// needs a CORS rule for app://lifeglance.
//
// After lastGLANCE's electron/httpProxy.ts, itself dayGLANCE's `proxy-fetch`
// handler, with their two rules:
//
//  - A request that never got a response (refused address, timeout, network
//    failure, redirect loop) comes back as `{ error }`, not as a made-up HTTP
//    status, and the page throws it. That is what Capacitor's native HTTP does
//    on the phones, so the app's error handling sees the same thing on every
//    platform, and no server is blamed for a status it never sent.
//  - Credentials are not carried across origins. A redirect to another
//    scheme, host or port drops Authorization, Cookie and Proxy-Authorization,
//    as browsers do: a WebDAV server that redirects elsewhere must not receive
//    the user's password on the other side.
//
// And one addition, for GLANCEvault's media (src/blobs/blobTransport.js):
// bytes. A body may be a Uint8Array as well as text, and `{ binary: true }`
// asks for the response body as a Uint8Array. Both cross IPC as they are.
//
// The transport and the URL check are injected, so this is tested without
// Electron.

export const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'PROPFIND', 'MKCOL'])
export const REQUEST_TIMEOUT_MS = 30_000
/** A media part, up or down, on a slow line: 4 MB at about 300 kbit/s. */
export const BINARY_TIMEOUT_MS = 120_000
export const MAX_REDIRECTS = 5

const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization'])

function originOf(url) {
  return new URL(url).origin
}

function withoutCredentials(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())))
}

/**
 * @param {object} deps
 * @param {(url: string, init: object) => Promise<Response>} deps.send
 * @param {(url: string, isRedirect: boolean) => Promise<void>} deps.validate  rejects with the reason when the URL may not be fetched
 * @param {number} [deps.timeoutMs]
 * @param {number} [deps.binaryTimeoutMs]
 * @returns {(method: unknown, url: unknown, headers: unknown, body: unknown, options?: unknown) => Promise<{ status: number, statusText: string, body: string | Uint8Array, headers: Record<string, string> } | { error: string }>}
 */
export function createHttpProxy(deps) {
  const textTimeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS
  const binaryTimeoutMs = deps.binaryTimeoutMs ?? Math.max(BINARY_TIMEOUT_MS, textTimeoutMs)

  return async function request(method, url, headers, body, options) {
    // Everything arrives over IPC: check the shapes before using them.
    const verb = typeof method === 'string' ? method.toUpperCase() : ''
    if (!ALLOWED_METHODS.has(verb)) return { error: `Method not allowed: ${String(method)}` }
    if (typeof url !== 'string') return { error: 'Invalid URL' }
    const bytesIn = body instanceof Uint8Array
    if (body != null && typeof body !== 'string' && !bytesIn) return { error: 'Only text and byte bodies are supported' }
    const bytesOut = !!options && typeof options === 'object' && options.binary === true
    const timeoutMs = bytesIn || bytesOut ? binaryTimeoutMs : textTimeoutMs
    const requestHeaders = {}
    if (headers && typeof headers === 'object') {
      for (const [name, value] of Object.entries(headers)) {
        if (typeof value === 'string') requestHeaders[name] = value
      }
    }

    try {
      await deps.validate(url, false)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Invalid URL' }
    }

    // No built-in timeout in net.fetch: a server that stops answering would
    // otherwise hold the sync lock until the app quits.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      // Followed by hand, because net.fetch's own redirects would skip the URL
      // check: a public server could 302 to http://127.0.0.1/.
      let currentUrl = url
      let currentMethod = verb
      let currentBody = body ?? null
      let currentHeaders = requestHeaders
      let response
      for (let hop = 0;; hop++) {
        response = await deps.send(currentUrl, {
          method: currentMethod,
          headers: currentHeaders,
          redirect: 'manual',
          signal: controller.signal,
          ...(currentBody != null ? { body: currentBody } : {}),
        })
        const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
        if (!location) break
        if (hop >= MAX_REDIRECTS) return { error: 'Too many redirects' }
        const nextUrl = new URL(location, currentUrl).toString()
        await deps.validate(nextUrl, true)
        if (originOf(nextUrl) !== originOf(currentUrl)) currentHeaders = withoutCredentials(currentHeaders)
        // fetch's method rewrite: 303 always, 301/302 on POST, become a bodyless GET.
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
          currentMethod = 'GET'
          currentBody = null
        }
        currentUrl = nextUrl
      }
      const responseBody = bytesOut ? new Uint8Array(await response.arrayBuffer()) : await response.text()
      const responseHeaders = {}
      response.headers.forEach((value, name) => { responseHeaders[name.toLowerCase()] = value })
      return { status: response.status, statusText: response.statusText, body: responseBody, headers: responseHeaders }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return { error: `The server did not respond within ${Math.round(timeoutMs / 1000)} s` }
      }
      return { error: e instanceof Error ? e.message : 'Network error' }
    } finally {
      clearTimeout(timer)
    }
  }
}
