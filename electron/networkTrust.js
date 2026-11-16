// Which servers the main process may reach for the renderer, and the user's
// per-server grants for private addresses (docs/desktop-app.md
// servers). The decisions are proxyUrlPolicy.js (pure, tested against
// proxy/ssrf-vectors.json); this module adds what is not pure (DNS, the grants
// file, the dialog), each injected so it is tested without Electron.
// After the trust block of dayGLANCE's electron/main.ts
// (krelltunez/dayGLANCE@8d72008).
//
// A private address is refused until the user grants its exact
// scheme://host:port, from the "Allow this address" button in Cloud Sync. The
// proxy never raises the dialog itself: a background sync poll must not be able
// to put a modal on screen, and a prompt the user did not ask for is one they
// click through.

import fs from 'node:fs'
import {
  canRequestConsent,
  decideProxyUrl,
  defaultTrustedHosts,
  formatHostKey,
  grantTrustedHost,
  hostKeyOf,
  parseTrustedHosts,
  revokeTrustedHost,
  sanitizeConsentLabels,

} from './proxyUrlPolicy.js'
import { writeFileAtomicSync } from './atomicWrite.js'

export function createNetworkTrust(deps) {
  const log = deps.log ?? (() => {})
  const now = deps.now ?? (() => new Date())

  // A missing, unreadable or corrupt file yields NO grants: failing that way
  // forgets a consent (one click restores it); the other way would invent one.
  let trusted = defaultTrustedHosts()
  try {
    if (fs.existsSync(deps.grantsFile)) trusted = parseTrustedHosts(fs.readFileSync(deps.grantsFile, 'utf-8'))
  } catch (err) {
    log(`network trust: grants file unreadable, starting with none: ${err instanceof Error ? err.message : String(err)}`)
    trusted = defaultTrustedHosts()
  }

  const save = () => {
    try {
      writeFileAtomicSync(deps.grantsFile, JSON.stringify(trusted, null, 2))
    } catch (err) {
      log(`network trust: could not save grants: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return {
    async validate(url, isRedirect = false) {
      const key = hostKeyOf(url)
      if (!key) {
        // Unparseable or not http(s); the policy words the reason.
        const decision = decideProxyUrl({ urlString: url, resolvedAddresses: [], trusted })
        throw new Error(decision.kind === 'deny' ? decision.reason : 'Invalid URL')
      }
      let addresses
      try {
        addresses = await deps.resolve(key.host)
      } catch {
        throw new Error('DNS resolution failed')
      }
      const decision = decideProxyUrl({ urlString: url, resolvedAddresses: addresses, trusted, isRedirect })
      if (decision.kind === 'allow') return
      throw new Error(decision.kind === 'deny' ? decision.reason : 'Private/reserved address')
    },

    async inspect(url) {
      const key = hostKeyOf(url)
      if (!key) return { blocked: false }
      let addresses
      try {
        addresses = await deps.resolve(key.host)
      } catch {
        return { blocked: false } // a DNS failure is the request's story to tell
      }
      const decision = decideProxyUrl({ urlString: url, resolvedAddresses: addresses, trusted })
      if (decision.kind === 'allow') return { blocked: false }
      if (decision.kind === 'needs-consent') {
        return { blocked: true, canGrant: true, origin: formatHostKey(decision.key), addresses: decision.addresses }
      }
      return { blocked: true, canGrant: false, origin: formatHostKey(key), reason: decision.reason }
    },

    async request(url, rawLabels) {
      const key = hostKeyOf(url)
      if (!key) return { ok: false, reason: 'Invalid URL' }
      let addresses
      try {
        addresses = await deps.resolve(key.host)
      } catch {
        return { ok: false, reason: 'DNS resolution failed' }
      }
      const check = canRequestConsent(url, addresses)
      if (!check.ok) return { ok: false, reason: check.reason }

      // Translated chrome comes from the renderer; the origin and addresses
      // are placed here, positionally, so no label can reorder or hide them.
      const labels = sanitizeConsentLabels(rawLabels)
      const origin = formatHostKey(check.key)
      const allowed = await deps.confirm({
        title: labels.title,
        message: `${labels.question}\n\n${origin}`,
        detail: [
          `${labels.resolvesTo} ${check.addresses.join(', ')}`,
          check.loopback ? labels.warningLoopback : labels.warning,
          labels.scope,
        ].join('\n\n'),
        allow: labels.allow,
        cancel: labels.cancel,
      })
      if (!allowed) return { ok: false, reason: 'Permission declined.' }

      trusted = grantTrustedHost(trusted, { ...check.key, grantedAt: now().toISOString(), addresses: check.addresses })
      save()
      log(`network trust: granted ${origin}`)
      return { ok: true }
    },

    list() {
      return trusted.hosts.map((h) => ({ origin: formatHostKey(h), grantedAt: h.grantedAt, addresses: h.addresses }))
    },

    revoke(origin) {
      const key = hostKeyOf(origin)
      if (!key) return { ok: false }
      trusted = revokeTrustedHost(trusted, key)
      save()
      log(`network trust: revoked ${formatHostKey(key)}`)
      return { ok: true }
    },
  }
}
