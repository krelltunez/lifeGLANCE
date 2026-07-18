// Shared SSRF guard for the WebDAV proxies (proxy/server.js and
// api/webdav-proxy.js). Both accept a client-supplied target URL and forward the
// user's Authorization header to it, so without this guard either one is an open
// relay that can be pointed at loopback, RFC-1918 hosts, or the cloud metadata
// endpoint (169.254.169.254) to steal instance credentials.
//
// Defence:
//   1. Only http/https targets are allowed.
//   2. The hostname is RESOLVED via DNS, and EVERY returned address is checked
//      against the private/reserved blocklist. Checking the resolved IPs (not the
//      hostname string) defeats "evil.com -> 10.0.0.5" style attacks where an
//      attacker points a public name at an internal address.
//   3. The WHATWG URL parser already canonicalises encoded IPv4 literals
//      (0x7f000001, 2130706433, 0177.0.0.1 -> 127.0.0.1), so those resolve to the
//      real address and get caught by step 2.
//   4. Callers that can pin the connection (the standalone server, via
//      http.request's `lookup` option) reuse the validated address so DNS can't
//      be re-resolved to a different IP between check and connect (rebinding).
import dns from 'dns'

const lookup = dns.promises.lookup

export class SsrfError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'SsrfError'
    this.status = status
  }
}

// Parse a dotted-decimal IPv4 string to an unsigned 32-bit int, or null.
function ipv4ToInt(ip) {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  let n = 0
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i])
    if (octet > 255) return null
    n = (n << 8) | octet
  }
  return n >>> 0
}

function inV4Range(n, base, bits) {
  const baseInt = ipv4ToInt(base)
  const shift = 32 - bits
  return (n >>> shift) === (baseInt >>> shift)
}

function isBlockedIPv4(ip) {
  const n = ipv4ToInt(ip)
  if (n === null) return false
  return (
    inV4Range(n, '0.0.0.0', 8) ||       // "this" network / 0.0.0.0
    inV4Range(n, '10.0.0.0', 8) ||      // RFC 1918 private
    inV4Range(n, '100.64.0.0', 10) ||   // RFC 6598 CGNAT
    inV4Range(n, '127.0.0.0', 8) ||     // loopback
    inV4Range(n, '169.254.0.0', 16) ||  // link-local incl. 169.254.169.254 metadata
    inV4Range(n, '172.16.0.0', 12) ||   // RFC 1918 private
    inV4Range(n, '192.0.0.0', 24) ||    // IETF protocol assignments
    inV4Range(n, '192.168.0.0', 16) ||  // RFC 1918 private
    inV4Range(n, '198.18.0.0', 15) ||   // benchmarking
    inV4Range(n, '224.0.0.0', 4) ||     // multicast
    inV4Range(n, '240.0.0.0', 4)        // reserved / 255.255.255.255
  )
}

// Extract the embedded IPv4 from an IPv4-mapped IPv6 address, or null. The URL
// parser and dns.lookup emit the compressed hex form (::ffff:a9fe:a9fe), not the
// dotted form (::ffff:169.254.169.254), so handle both.
function mappedIPv4(s) {
  const m = s.match(/^::ffff:(.+)$/i)
  if (!m) return null
  const rest = m[1]
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rest)) return rest
  const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (hex) {
    const hi = parseInt(hex[1], 16)
    const lo = parseInt(hex[2], 16)
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
  }
  return null
}

function isBlockedIPv6(ip) {
  const s = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  const embedded = mappedIPv4(s)
  if (embedded) return isBlockedIPv4(embedded)
  if (s === '::1' || s === '::') return true   // loopback / unspecified
  if (/^fe[89ab]/.test(s)) return true          // fe80::/10 link-local
  if (/^f[cd]/.test(s)) return true             // fc00::/7 unique-local
  if (/^ff/.test(s)) return true                // ff00::/8 multicast
  return false
}

function isBlockedAddress(address, family) {
  return family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address)
}

// Validate a client-supplied target URL. Resolves the host and rejects if the
// URL is malformed, the scheme is not http(s), DNS fails, or ANY resolved address
// is private/reserved. Resolves to { url, addresses } where addresses is the
// validated dns.lookup result (usable with pinnedLookup below). Throws SsrfError.
export async function assertSafeUrl(target) {
  let url
  try {
    url = new URL(target)
  } catch {
    throw new SsrfError(400, 'Invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(400, 'Unsupported protocol')
  }
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '')

  let addresses
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new SsrfError(502, 'DNS resolution failed')
  }
  if (!addresses.length) {
    throw new SsrfError(502, 'DNS resolution failed')
  }
  for (const { address, family } of addresses) {
    if (isBlockedAddress(address, family)) {
      throw new SsrfError(403, 'Target resolves to a private or reserved address')
    }
  }
  return { url, addresses }
}

// Build a `lookup` function for http/https request options that returns the
// already-validated addresses, so the connection cannot be re-resolved to a
// different (unchecked) IP between validation and connect. SNI/Host stay derived
// from the original hostname, so TLS cert validation is unaffected.
export function pinnedLookup(addresses) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    if (options && options.all) return callback(null, addresses)
    const first = addresses[0]
    return callback(null, first.address, first.family)
  }
}

// Exposed for unit tests.
export const _internal = { isBlockedIPv4, isBlockedIPv6, ipv4ToInt }
