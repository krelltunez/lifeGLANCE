// From dayGLANCE electron/proxyUrlPolicy.ts (krelltunez/dayGLANCE@8d72008), by
// way of lastGLANCE's. Held to proxy/ssrf-vectors.json, the same table this
// repo's web proxy is held to (proxyUrlPolicy.vectors.test.js).
//
// SSRF policy for the renderer's IPC proxy (main.js `proxy-fetch`), extracted as
// pure decision functions in the localIntegrations.js style: the ranges, the
// never-exemptible set, the trusted-host record shape and the allow/deny/consent
// decision all live here, tested; DNS, disk and the consent dialog live in main.js.
//
// WHY THIS IS NOT A FLAT BLOCK (issue #1642)
//
// The proxy used to reject every private, loopback, link-local, CGNAT or ULA
// address outright. On a hosted relay (api/webdav-proxy.js, proxy/server.js)
// that is correct and stays correct: those run on someone else's network and a
// flat block is the only thing standing between a stranger's URL and the
// operator's internal services.
//
// The Electron proxy is a different machine with a different threat model. It
// runs on the user's own desktop, and the whole point of a self-hosted
// GLANCEvault is that it lives on the user's own network: a LAN box on
// 192.168.x.x, a Docker host on 10.x.x.x, or a Tailscale node, whose addresses
// are CGNAT (100.64.0.0/10) and ULA (fd7a:115c:a1e0::/48) and so hit two of the
// blocked ranges at once. A flat block there does not protect the user from a
// stranger; it locks the user out of their own server on desktop ONLY, while
// Android/iOS (native HTTP bridge) and the browser build reach it fine.
//
// So the range check stays, and an address in one of those ranges is still
// refused by default. What changes is that the user can grant one specific
// host:port an exemption, through a native dialog main.js raises from an
// explicit button press. Three properties keep that from being a hole:
//
//   1. Consent is per host:port:scheme, never per range, and never a wildcard.
//   2. Redirect targets are NEVER exempt, whatever is on the list. A public URL
//      that 302s into private space is the classic SSRF shape and the one this
//      guard exists for; a grant for the vault must not also buy a redirect hop
//      from some unrelated calendar feed. Callers pass `isRedirect: true`.
//   3. Link-local and the unspecified address are never exemptible at all
//      (see isNeverExemptibleIp). Loopback IS grantable, because a vault in
//      Docker on this same machine is a normal setup, but it is scoped to the
//      one port consented to and gets its own dialog copy.

/** A granted exemption. Scoped to one origin, never to a range. */

/** The origin an exemption is keyed by. */

export function defaultTrustedHosts() {
  return { version: 1, hosts: [] }
}

// True for an IP address (v4 or v6 literal, no brackets) that is loopback,
// private (RFC1918), link-local, CGNAT, or otherwise reserved. Shared by the
// literal-host path and the DNS-resolution path so both judge the same ranges.
// An IPv4-mapped IPv6 address carries a real IPv4 address inside it, in either
// the dotted or the compressed hex form. Decoding it is what stops
// ::ffff:169.254.169.254 being judged on its v6 spelling rather than on the
// address it actually reaches.
function mappedIPv4(h) {
  const m = h.match(/^::ffff:(.+)$/i)
  if (!m) return null
  const rest = m[1]
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rest)) return rest
  const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (!hex) return null
  const hi = parseInt(hex[1], 16)
  const lo = parseInt(hex[2], 16)
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
}

export function isPrivateOrReservedIp(ip) {
  const h = ip.toLowerCase()
  const mapped = mappedIPv4(h)
  if (mapped) return isPrivateOrReservedIp(mapped)

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      a === 0 ||
      (a === 100 && b >= 64 && b <= 127) ||
      // Reserved space that carries no reachable server. Kept in step with
      // proxy/ssrfGuard.js; proxyUrlPolicy.vectors.test.js fails if they drift.
      (a === 192 && b === 0 && Number(ipv4[3]) === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a >= 224 && a <= 239) ||
      a >= 240
    )
  }

  return (
    h === '::1' || h === '::' ||
    /^fe[89ab]/i.test(h) || /^ff/i.test(h) ||
    /^fc/i.test(h) || /^fd/i.test(h)
  )
}

// True for a host that always means "this computer", judged by NAME rather than
// by resolution: `localhost` and any `*.localhost` label (RFC 6761), plus the
// loopback literals. Chromium routes `localhost` to loopback itself without
// consulting DNS, so a resolver that answered something else for it would not
// change where the request actually goes; classifying by name keeps this
// function's answer and the socket's destination in agreement.
export function isLoopbackHost(host) {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1') return true
  // An IPv4-mapped loopback literal is still loopback, so it earns the same
  // dialog copy rather than the "server on your network" wording.
  if (/^::ffff:127\./i.test(h)) return true
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  return !!ipv4 && Number(ipv4[1]) === 127
}

// Addresses NO consent can unlock, because nothing a user would legitimately
// call a vault lives there and every one of them is a known SSRF prize:
//
//   169.254.0.0/16, fe80::/10  link-local, which carries the cloud metadata
//                          endpoint 169.254.169.254 (instance credentials).
//   0.0.0.0/8, ::          the unspecified address. Not a destination anyone
//                          configures; on some platforms it lands on loopback
//                          and on others it simply fails.
//   192.0.0.0/24, 198.18.0.0/15, 224.0.0.0/4, 240.0.0.0/4, ff00::/8
//                          IETF assignments, benchmarking, multicast and
//                          reserved space. You cannot run a vault on any of
//                          them, so consent would be meaningless.
//
// LOOPBACK IS DELIBERATELY NOT HERE. Running GLANCEvault in Docker on the same
// machine as the desktop app is a normal self-hosting setup, and refusing it
// would recreate issue #1642 for those users. It is grantable, not free: it
// still takes an explicit consent naming the exact port, it gets its own,
// sharper dialog copy, and the three properties in the header keep the blast
// radius to that one port. A grant for the vault on :8080 is not a grant for a
// model runner on :11434.
//
// Everything else private (RFC1918, CGNAT/Tailscale, ULA) is refused by default
// but CAN be granted per origin.
export function isNeverExemptibleIp(ip) {
  const h = ip.toLowerCase()
  const mapped = mappedIPv4(h)
  // Without this, ::ffff:169.254.169.254 read as "merely private" and was
  // therefore GRANTABLE: a user could consent to the cloud metadata endpoint
  // by spelling it in IPv4-mapped form.
  if (mapped) return isNeverExemptibleIp(mapped)

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    return (
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 192 && b === 0 && Number(ipv4[3]) === 0) || // IETF assignments
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a >= 224 && a <= 239) || // multicast
      a >= 240 // reserved
    )
  }

  return h === '::' || /^fe[89ab]/i.test(h) || /^ff/i.test(h)
}

/**
 * Parse a URL into the origin an exemption is keyed by.
 * Returns null for anything not an http(s) URL.
 */
export function hostKeyOf(urlString) {
  let parsed
  try { parsed = new URL(urlString) } catch { return null }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  const lower = parsed.hostname.toLowerCase()
  // URL keeps the brackets on IPv6 literals (e.g. "[::1]"); strip them so the
  // stored key matches what the range checks and net.isIP see.
  const host = lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower

  return { host, protocol: parsed.protocol, port: parsed.port }
}

export function sameHostKey(a, b) {
  return a.host === b.host && a.protocol === b.protocol && a.port === b.port
}

export function findTrustedHost(file, key) {
  return file.hosts.find((h) => sameHostKey(h, key)) ?? null
}

/** Add or replace a grant. Re-granting refreshes the timestamp and addresses. */
export function grantTrustedHost(file, entry) {
  return {
    version: 1,
    hosts: [...file.hosts.filter((h) => !sameHostKey(h, entry)), entry],
  }
}

export function revokeTrustedHost(file, key) {
  return { version: 1, hosts: file.hosts.filter((h) => !sameHostKey(h, key)) }
}

/**
 * Read a trusted-hosts file off disk into a usable value. A corrupt or
 * unrecognised file is treated as EMPTY, never as "allow": an exemption must
 * always trace back to a consent the user actually gave, so the failure
 * direction here is to forget grants, not to invent them.
 */
export function parseTrustedHosts(raw) {
  let data
  try { data = JSON.parse(raw) } catch { return defaultTrustedHosts() }
  if (!data || typeof data !== 'object') return defaultTrustedHosts()

  const hostsRaw = (data).hosts
  if (!Array.isArray(hostsRaw)) return defaultTrustedHosts()

  const hosts = []
  for (const h of hostsRaw) {
    if (!h || typeof h !== 'object') continue
    const { host, protocol, port, grantedAt, addresses } = h
    if (typeof host !== 'string' || !host) continue
    if (protocol !== 'http:' && protocol !== 'https:') continue
    if (typeof port !== 'string') continue
    // A grant for an address no consent could have covered is dropped rather
    // than honoured, so hand-editing the file cannot widen the policy.
    if (isNeverExemptibleIp(host)) continue
    hosts.push({
      host: host.toLowerCase(),
      protocol,
      port,
      grantedAt: typeof grantedAt === 'string' ? grantedAt : '',
      addresses: Array.isArray(addresses) ? addresses.filter((a) => typeof a === 'string') : [],
    })
  }
  return { version: 1, hosts }
}

/**
 * The whole policy in one place.
 *
 * `deny` reasons are the strings main.js throws, so they are the strings the
 * renderer sees in the proxy's 400 body. 'Private/reserved address' is kept
 * verbatim from the pre-#1642 guard: it is what existing error paths match on.
 */
export function decideProxyUrl(input) {
  const { urlString, resolvedAddresses, trusted, isRedirect = false } = input

  let parsed
  try { parsed = new URL(urlString) } catch { return { kind: 'deny', reason: 'Invalid URL' } }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'deny', reason: 'Only http and https URLs are allowed' }
  }
  const key = hostKeyOf(urlString)

  // Refused by name before any resolution: nobody configures a server at the
  // unspecified address, and judging it by name means a resolver that answered
  // something public for it cannot talk the policy into allowing it.
  if (key.host === '0.0.0.0') return { kind: 'deny', reason: 'Private/reserved address' }

  // A loopback host counts as a private hit on its NAME, so `localhost` does not
  // depend on DNS agreeing with Chromium about where it points.
  const loopbackByName = isLoopbackHost(key.host)
  const privateHits = resolvedAddresses.filter((a) => isPrivateOrReservedIp(a))
  if (!loopbackByName && privateHits.length === 0) return { kind: 'allow' }

  if (privateHits.some((a) => isNeverExemptibleIp(a))) {
    return { kind: 'deny', reason: 'Private/reserved address' }
  }

  // A public URL that redirects into private space is the attack this guard was
  // written for. No grant reaches here.
  if (isRedirect) return { kind: 'deny', reason: 'Private/reserved address' }

  if (findTrustedHost(trusted, key)) return { kind: 'allow' }

  // Report the name for a loopback host that resolved to nothing usable, so the
  // dialog and the settings list always have something to show.
  const addresses = privateHits.length > 0 ? privateHits : [key.host]
  // Drives the sharper dialog copy: reaching another service on this very
  // machine is a different ask from reaching a box across the room.
  const loopback = loopbackByName || addresses.every((a) => isLoopbackHost(a))
  return { kind: 'needs-consent', key, addresses, loopback }
}

/**
 * Whether main.js may offer the consent dialog for this URL at all. Called by
 * the `proxy-trust:request` IPC before any dialog is shown, so a URL that could
 * never be granted is refused without putting a pointless prompt on screen.
 */
export function canRequestConsent(
  urlString,
  resolvedAddresses,
) {
  const decision = decideProxyUrl({
    urlString,
    resolvedAddresses,
    trusted: defaultTrustedHosts(),
  })
  if (decision.kind === 'needs-consent') {
    return { ok: true, key: decision.key, addresses: decision.addresses, loopback: decision.loopback }
  }
  if (decision.kind === 'allow') {
    // Nothing private about it, so there is nothing to grant.
    return { ok: false, reason: 'This address does not need permission.' }
  }
  return { ok: false, reason: decision.reason }
}

// The consent dialog's translated chrome. lifeGLANCE ships ten languages and
// the main process holds no locale bundle, so the renderer passes the strings
// through with the request, the way the application menu already does
// (applicationMenu.js). What the renderer CANNOT influence is the security
// content: the origin and the addresses it resolved to are composed by main.js
// and appended positionally, never interpolated into a renderer template, so no
// label can reorder or hide them.

export const DEFAULT_CONSENT_LABELS = {
  title: 'Allow a private network address?',
  question: 'Allow lifeGLANCE to connect to this address?',
  resolvesTo: 'It resolves to a private network address:',
  warning:
    'Only allow this if it is your own server, on your own network (a home or office LAN, '
    + 'a Docker host, or a VPN such as Tailscale). lifeGLANCE will be able to reach it, and '
    + 'anything it returns becomes part of your data.',
  warningLoopback:
    'This address is a service running on this computer. Only allow it if it is your own '
    + 'GLANCEvault and the port is the one it listens on. Other programs on this machine '
    + 'are reachable at other ports, and this permission does not cover them.',
  scope: 'This applies to this one address only. You can remove it later in Settings, under Cloud Sync.',
  allow: 'Allow',
  cancel: 'Cancel',
}

const MAX_LABEL_LENGTH = 400

/**
 * Coerce whatever arrived over IPC into usable dialog chrome. Anything missing,
 * non-string, empty, or implausibly long falls back to the English default, so a
 * broken or absent labels payload still produces a readable prompt rather than
 * an empty or attacker-shaped one. Control characters are stripped: a label must
 * not be able to inject blank lines that push the origin out of view.
 */
export function sanitizeConsentLabels(raw) {
  const source = (raw && typeof raw === 'object') ? raw : {}
  const out = { ...DEFAULT_CONSENT_LABELS }
  for (const field of Object.keys(DEFAULT_CONSENT_LABELS)) {
    // Own properties only: a plain `source[field]` would read an inherited one,
    // so a payload carrying a prototype could supply the dialog's button text.
    if (!Object.hasOwn(source, field)) continue
    const value = source[field]
    if (typeof value !== 'string') continue
    // eslint-disable-next-line no-control-regex
    const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
    if (!cleaned || cleaned.length > MAX_LABEL_LENGTH) continue
    out[field] = cleaned
  }
  return out
}

/** Render a grant's origin the way the dialog and the settings list show it. */
export function formatHostKey(key) {
  const scheme = key.protocol === 'https:' ? 'https' : 'http'
  const host = key.host.includes(':') ? `[${key.host}]` : key.host
  return key.port ? `${scheme}://${host}:${key.port}` : `${scheme}://${host}`
}
