import http from 'http'
import https from 'https'
import { URL } from 'url'
import { assertSafeUrl, pinnedLookup, SsrfError } from './ssrfGuard.js'

const PORT = 3001

// Opt-in: accept a self-signed / untrusted TLS cert on the upstream HTTPS WebDAV
// server. Many self-hosted NAS WebDAV servers (e.g. Synology on :5006) ship a
// self-signed cert, which Node's https.request rejects by default — the upstream
// request then errors and the proxy returns 502 before any request reaches the
// NAS. Enabling this sets rejectUnauthorized:false on the upstream request ONLY.
// Trust trade-off: only enable on a trusted LAN talking to your own NAS; it
// disables cert verification for the proxied WebDAV hop. Off by default.
const INSECURE_TLS = process.env.WEBDAV_PROXY_INSECURE_TLS === '1' ||
  process.env.WEBDAV_PROXY_INSECURE_TLS === 'true'
if (INSECURE_TLS) {
  console.warn('[webdav-proxy] WEBDAV_PROXY_INSECURE_TLS enabled — upstream HTTPS cert verification is OFF')
}

const FORWARD_REQ_HEADERS = [
  'authorization', 'x-webdav-auth', 'content-type',
  'if-match', 'depth', 'destination',
]
const FORWARD_RES_HEADERS = [
  'content-type', 'etag', 'last-modified', 'dav', 'allow',
]

http.createServer(async (req, res) => {
  // Support both ?url= (used by @glance-apps/sync) and X-WebDAV-Url header (used by intents transport)
  const qs = new URL(req.url, 'http://localhost').searchParams
  const target = qs.get('url') || req.headers['x-webdav-url']

  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'Missing target URL' }))
  }

  // SSRF guard: validate scheme, resolve DNS, and reject any private/reserved
  // target. Always enforced (previously gated on VERCEL, so self-hosted runs were
  // an open relay). `addresses` is reused below to pin the outbound connection.
  let url, addresses
  try {
    ({ url, addresses } = await assertSafeUrl(target))
  } catch (err) {
    if (err instanceof SsrfError) {
      res.writeHead(err.status, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: err.message }))
    }
    throw err
  }

  const headers = {}
  for (const h of FORWARD_REQ_HEADERS) {
    if (req.headers[h]) headers[h] = req.headers[h]
    // x-webdav-auth carries credentials — map to Authorization for the upstream
    if (h === 'x-webdav-auth' && req.headers[h] && !req.headers['authorization']) {
      headers['authorization'] = req.headers[h]
    }
  }

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = chunks.length ? Buffer.concat(chunks) : null

  const lib = url.protocol === 'https:' ? https : http
  // Pin the connection to the address we validated so DNS can't be re-resolved to
  // a different (unchecked) IP between the guard and the connect (rebinding).
  const reqOptions = { method: req.method, headers, lookup: pinnedLookup(addresses) }
  // Accept a self-signed upstream cert only when explicitly opted in, and only for
  // the HTTPS hop (no effect on plain HTTP).
  if (url.protocol === 'https:' && INSECURE_TLS) reqOptions.rejectUnauthorized = false
  const upstreamReq = lib.request(
    target,
    reqOptions,
    (upstreamRes) => {
      const resHeaders = {}
      for (const h of FORWARD_RES_HEADERS) {
        const v = upstreamRes.headers[h]
        if (v) resHeaders[h] = v
      }
      res.writeHead(upstreamRes.statusCode, resHeaders)
      upstreamRes.pipe(res)
    }
  )

  upstreamReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Upstream error', detail: err.message }))
    }
  })

  if (body) upstreamReq.write(body)
  upstreamReq.end()
}).listen(PORT, () => {
  console.log(`WebDAV proxy listening on :${PORT}`)
})
