// From dayGLANCE electron/proxyUrlPolicy.test.ts (krelltunez/dayGLANCE@8d72008).
import { describe, it, expect } from 'vitest'
import {
  isPrivateOrReservedIp,
  isNeverExemptibleIp,
  hostKeyOf,
  findTrustedHost,
  grantTrustedHost,
  revokeTrustedHost,
  parseTrustedHosts,
  decideProxyUrl,
  canRequestConsent,
  formatHostKey,
  isLoopbackHost,
  sanitizeConsentLabels,
  DEFAULT_CONSENT_LABELS,
  defaultTrustedHosts,

} from './proxyUrlPolicy.js'

// Issue #1642's rule under test: a private address is still refused by default,
// but a SPECIFIC origin the user consented to gets through. A grant is scoped to
// one scheme+host+port and never reaches a redirect hop, link-local, or the
// unspecified address. Loopback IS grantable (a vault in Docker on this machine
// is a normal setup) but only per port, and it is flagged so the dialog can say
// something sharper.

const grant = (over = {}) => ({
  host: 'vault.example.com',
  protocol: 'https:',
  port: '',
  grantedAt: '2026-09-14T00:00:00.000Z',
  addresses: ['100.101.102.103'],
  ...over,
})

describe('isPrivateOrReservedIp', () => {
  it('flags the RFC1918 ranges a home server actually uses', () => {
    expect(isPrivateOrReservedIp('192.168.1.10')).toBe(true)
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true)
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true)
    expect(isPrivateOrReservedIp('172.31.255.254')).toBe(true)
  })

  it('does NOT flag 172.15/172.32, which are public', () => {
    expect(isPrivateOrReservedIp('172.15.0.1')).toBe(false)
    expect(isPrivateOrReservedIp('172.32.0.1')).toBe(false)
  })

  it('flags the CGNAT block, which is where every Tailscale v4 address lives', () => {
    expect(isPrivateOrReservedIp('100.64.0.0')).toBe(true)
    expect(isPrivateOrReservedIp('100.101.102.103')).toBe(true)
    expect(isPrivateOrReservedIp('100.127.255.255')).toBe(true)
  })

  it('does NOT flag 100.63 / 100.128, which sit outside 100.64.0.0/10', () => {
    expect(isPrivateOrReservedIp('100.63.255.255')).toBe(false)
    expect(isPrivateOrReservedIp('100.128.0.0')).toBe(false)
  })

  it('flags loopback, link-local and "this network"', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true)
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true)
    expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true)
  })

  it('flags the v6 loopback, link-local and ULA ranges', () => {
    expect(isPrivateOrReservedIp('::1')).toBe(true)
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true)
    expect(isPrivateOrReservedIp('fd00::1')).toBe(true)
    // Tailscale's own v6 prefix, fd7a:115c:a1e0::/48.
    expect(isPrivateOrReservedIp('fd7a:115c:a1e0::1')).toBe(true)
  })

  it('lets ordinary public addresses through', () => {
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false)
    expect(isPrivateOrReservedIp('2606:4700::1111')).toBe(false)
  })
})

describe('isLoopbackHost', () => {
  it('recognises loopback by NAME, so it does not depend on DNS', () => {
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('LOCALHOST')).toBe(true)
    expect(isLoopbackHost('vault.localhost')).toBe(true) // RFC 6761
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('127.1.2.3')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    expect(isLoopbackHost('::ffff:127.0.0.1')).toBe(true)
  })

  it('does not over-match a name that merely contains "localhost"', () => {
    expect(isLoopbackHost('localhost.evil.com')).toBe(false)
    expect(isLoopbackHost('notlocalhost')).toBe(false)
    expect(isLoopbackHost('192.168.1.10')).toBe(false)
  })
})

describe('isNeverExemptibleIp', () => {
  it('covers link-local and the unspecified address — no consent unlocks these', () => {
    expect(isNeverExemptibleIp('0.0.0.0')).toBe(true)
    expect(isNeverExemptibleIp('0.1.2.3')).toBe(true)
    expect(isNeverExemptibleIp('169.254.169.254')).toBe(true)
    expect(isNeverExemptibleIp('::')).toBe(true)
    expect(isNeverExemptibleIp('fe80::1')).toBe(true)
  })

  it('leaves LOOPBACK grantable: a vault in Docker on this machine is a real setup', () => {
    expect(isNeverExemptibleIp('127.0.0.1')).toBe(false)
    expect(isNeverExemptibleIp('::1')).toBe(false)
  })

  it('leaves the ranges a self-hosted vault legitimately uses grantable', () => {
    expect(isNeverExemptibleIp('192.168.1.10')).toBe(false)
    expect(isNeverExemptibleIp('10.0.0.5')).toBe(false)
    expect(isNeverExemptibleIp('100.101.102.103')).toBe(false)
    expect(isNeverExemptibleIp('fd7a:115c:a1e0::1')).toBe(false)
  })

  it('is a strict subset of the blocked set, so nothing is exemptible-but-public', () => {
    const samples = [
      '127.0.0.1', '0.0.0.0', '169.254.169.254', '::1', '::', 'fe80::1',
      '192.168.1.1', '10.0.0.1', '172.16.0.1', '100.64.0.1', 'fd00::1',
    ]
    for (const ip of samples) {
      if (isNeverExemptibleIp(ip)) expect(isPrivateOrReservedIp(ip)).toBe(true)
    }
  })
})

describe('hostKeyOf', () => {
  it('lowercases the host and keeps the port and scheme apart', () => {
    expect(hostKeyOf('https://Vault.Example.COM:8443/sync')).toEqual({
      host: 'vault.example.com', protocol: 'https:', port: '8443',
    })
  })

  it('reports an absent port as the empty string, not the implied default', () => {
    expect(hostKeyOf('https://vault.example.com/')).toEqual({
      host: 'vault.example.com', protocol: 'https:', port: '',
    })
  })

  it('strips the brackets URL keeps around an IPv6 literal', () => {
    expect(hostKeyOf('https://[fd7a:115c:a1e0::1]:8443/')).toEqual({
      host: 'fd7a:115c:a1e0::1', protocol: 'https:', port: '8443',
    })
  })

  it('rejects non-http(s) schemes and unparseable input', () => {
    expect(hostKeyOf('file:///etc/passwd')).toBeNull()
    expect(hostKeyOf('ftp://example.com')).toBeNull()
    expect(hostKeyOf('not a url')).toBeNull()
  })
})

describe('grant bookkeeping', () => {
  it('finds a grant only on an exact host+scheme+port match', () => {
    const file = grantTrustedHost(defaultTrustedHosts(), grant({ port: '8443' }))
    expect(findTrustedHost(file, hostKeyOf('https://vault.example.com:8443/') )).toBeTruthy()
    // Different port, different scheme, different host: all misses.
    expect(findTrustedHost(file, hostKeyOf('https://vault.example.com:9443/') )).toBeNull()
    expect(findTrustedHost(file, hostKeyOf('http://vault.example.com:8443/') )).toBeNull()
    expect(findTrustedHost(file, hostKeyOf('https://other.example.com:8443/') )).toBeNull()
  })

  it('re-granting replaces rather than duplicates', () => {
    let file = grantTrustedHost(defaultTrustedHosts(), grant({ grantedAt: 'first' }))
    file = grantTrustedHost(file, grant({ grantedAt: 'second' }))
    expect(file.hosts).toHaveLength(1)
    expect(file.hosts[0].grantedAt).toBe('second')
  })

  it('revoking removes exactly one origin and leaves the rest', () => {
    let file = grantTrustedHost(defaultTrustedHosts(), grant())
    file = grantTrustedHost(file, grant({ host: 'other.example.com' }))
    file = revokeTrustedHost(file, hostKeyOf('https://vault.example.com/') )
    expect(file.hosts.map((h) => h.host)).toEqual(['other.example.com'])
  })
})

describe('parseTrustedHosts', () => {
  it('round-trips a file it wrote', () => {
    const file = grantTrustedHost(defaultTrustedHosts(), grant())
    expect(parseTrustedHosts(JSON.stringify(file))).toEqual(file)
  })

  it('treats corrupt or unrecognised content as NO grants, never as allow', () => {
    expect(parseTrustedHosts('{oops')).toEqual(defaultTrustedHosts())
    expect(parseTrustedHosts('null')).toEqual(defaultTrustedHosts())
    expect(parseTrustedHosts('[]')).toEqual(defaultTrustedHosts())
    expect(parseTrustedHosts('{"version":1}')).toEqual(defaultTrustedHosts())
  })

  it('drops a hand-edited entry that would unlock metadata or the unspecified address', () => {
    const raw = JSON.stringify({
      version: 1,
      hosts: [grant({ host: '169.254.169.254' }), grant({ host: '0.0.0.0' }), grant()],
    })
    expect(parseTrustedHosts(raw).hosts.map((h) => h.host)).toEqual(['vault.example.com'])
  })

  it('keeps a loopback grant, which is a legitimate same-machine vault', () => {
    const raw = JSON.stringify({
      version: 1,
      hosts: [grant({ host: '127.0.0.1', port: '8080' }), grant({ host: 'localhost', port: '8080' })],
    })
    expect(parseTrustedHosts(raw).hosts.map((h) => h.host)).toEqual(['127.0.0.1', 'localhost'])
  })

  it('drops entries missing the fields a grant is keyed by', () => {
    const raw = JSON.stringify({
      version: 1,
      hosts: [{ host: '' }, { host: 'a.com', protocol: 'ftp:', port: '' }, { host: 'b.com', protocol: 'https:' }],
    })
    expect(parseTrustedHosts(raw).hosts).toEqual([])
  })
})

describe('decideProxyUrl', () => {
  const empty = defaultTrustedHosts()

  it('allows a public address with no grant involved', () => {
    expect(decideProxyUrl({
      urlString: 'https://vault.example.com/salt/acc',
      resolvedAddresses: ['203.0.113.10'],
      trusted: empty,
    })).toEqual({ kind: 'allow' })
  })

  it('asks for consent for a Tailscale-backed custom domain — issue #1642', () => {
    const decision = decideProxyUrl({
      urlString: 'https://vault.example.com/salt/acc',
      resolvedAddresses: ['100.101.102.103'],
      trusted: empty,
    })
    expect(decision).toEqual({
      kind: 'needs-consent',
      key: { host: 'vault.example.com', protocol: 'https:', port: '' },
      addresses: ['100.101.102.103'],
      loopback: false,
    })
  })

  it('asks for consent for a plain LAN address too', () => {
    expect(decideProxyUrl({
      urlString: 'https://192.168.1.50:8443/salt/acc',
      resolvedAddresses: ['192.168.1.50'],
      trusted: empty,
    }).kind).toBe('needs-consent')
  })

  it('allows the exact origin the user granted', () => {
    const trusted = grantTrustedHost(empty, grant())
    expect(decideProxyUrl({
      urlString: 'https://vault.example.com/salt/acc',
      resolvedAddresses: ['100.101.102.103'],
      trusted,
    })).toEqual({ kind: 'allow' })
  })

  it('does not extend a grant to a sibling origin on the same private address', () => {
    const trusted = grantTrustedHost(empty, grant())
    expect(decideProxyUrl({
      urlString: 'https://router.example.com/admin',
      resolvedAddresses: ['100.101.102.103'],
      trusted,
    }).kind).toBe('needs-consent')
  })

  it('NEVER allows a redirect hop into private space, grant or no grant', () => {
    const trusted = grantTrustedHost(empty, grant())
    expect(decideProxyUrl({
      urlString: 'https://vault.example.com/salt/acc',
      resolvedAddresses: ['100.101.102.103'],
      trusted,
      isRedirect: true,
    })).toEqual({ kind: 'deny', reason: 'Private/reserved address' })
  })

  it('denies metadata and the unspecified address, even with a grant on file', () => {
    // grantTrustedHost does not filter, so this is the strongest form of the
    // check: the grant is present and is still ignored.
    expect(decideProxyUrl({
      urlString: 'https://169.254.169.254/latest/meta-data/',
      resolvedAddresses: ['169.254.169.254'],
      trusted: grantTrustedHost(empty, grant({ host: '169.254.169.254' })),
    })).toEqual({ kind: 'deny', reason: 'Private/reserved address' })

    expect(decideProxyUrl({
      urlString: 'http://0.0.0.0:8443/',
      resolvedAddresses: ['203.0.113.10'],
      trusted: grantTrustedHost(empty, grant({ host: '0.0.0.0', port: '8443' })),
    })).toEqual({ kind: 'deny', reason: 'Private/reserved address' })
  })

  // ── loopback: grantable, but only for the exact port consented to ──────────

  it('asks for consent for a same-machine vault, and flags it as loopback', () => {
    expect(decideProxyUrl({
      urlString: 'http://localhost:8080/salt/acc',
      resolvedAddresses: ['127.0.0.1'],
      trusted: empty,
    })).toEqual({
      kind: 'needs-consent',
      key: { host: 'localhost', protocol: 'http:', port: '8080' },
      addresses: ['127.0.0.1'],
      loopback: true,
    })
  })

  it('allows a granted loopback origin', () => {
    const trusted = grantTrustedHost(empty, grant({ host: 'localhost', protocol: 'http:', port: '8080' }))
    expect(decideProxyUrl({
      urlString: 'http://localhost:8080/salt/acc',
      resolvedAddresses: ['127.0.0.1'],
      trusted,
    })).toEqual({ kind: 'allow' })
  })

  it('does NOT let a loopback grant reach another port on this machine', () => {
    // The property that bounds the blast radius: permitting the vault on :8080
    // buys nothing for a model runner on :11434 or any other local service.
    const trusted = grantTrustedHost(empty, grant({ host: 'localhost', protocol: 'http:', port: '8080' }))
    for (const url of [
      'http://localhost:11434/api/tags',
      'http://localhost:7893/mcp',
      'http://127.0.0.1:8080/salt/acc', // same port, different spelling of the host
      'https://localhost:8080/salt/acc', // same host and port, different scheme
    ]) {
      expect(decideProxyUrl({ urlString: url, resolvedAddresses: ['127.0.0.1'], trusted }).kind)
        .toBe('needs-consent')
    }
  })

  it('treats a loopback host as private even when DNS claims otherwise', () => {
    // Chromium sends `localhost` to loopback without asking DNS, so a resolver
    // answering with a public address must not turn into an allow.
    expect(decideProxyUrl({
      urlString: 'http://localhost:8080/',
      resolvedAddresses: ['203.0.113.10'],
      trusted: empty,
    })).toMatchObject({ kind: 'needs-consent', loopback: true })
  })

  it('still refuses a loopback redirect target, grant or no grant', () => {
    const trusted = grantTrustedHost(empty, grant({ host: 'localhost', protocol: 'http:', port: '8080' }))
    expect(decideProxyUrl({
      urlString: 'http://localhost:8080/salt/acc',
      resolvedAddresses: ['127.0.0.1'],
      trusted,
      isRedirect: true,
    })).toEqual({ kind: 'deny', reason: 'Private/reserved address' })
  })

  it('flags a mixed public+loopback resolution as needing consent, not as public', () => {
    // The rebinding shape: one public record to look legitimate, one loopback
    // record to actually reach. The private hit still governs.
    expect(decideProxyUrl({
      urlString: 'https://mixed.example.com/',
      resolvedAddresses: ['203.0.113.10', '127.0.0.1'],
      trusted: empty,
    })).toMatchObject({ kind: 'needs-consent', addresses: ['127.0.0.1'], loopback: true })
  })

  it('does not flag a LAN address as loopback', () => {
    expect(decideProxyUrl({
      urlString: 'https://192.168.1.50:8443/',
      resolvedAddresses: ['192.168.1.50'],
      trusted: empty,
    })).toMatchObject({ kind: 'needs-consent', loopback: false })
  })

  it('refuses a non-http(s) scheme', () => {
    expect(decideProxyUrl({
      urlString: 'file:///etc/passwd',
      resolvedAddresses: [],
      trusted: empty,
    })).toEqual({ kind: 'deny', reason: 'Only http and https URLs are allowed' })
  })
})

describe('canRequestConsent', () => {
  it('approves a prompt for a grantable private address', () => {
    const result = canRequestConsent('https://vault.example.com/', ['100.101.102.103'])
    expect(result).toEqual({
      ok: true,
      key: { host: 'vault.example.com', protocol: 'https:', port: '' },
      addresses: ['100.101.102.103'],
      loopback: false,
    })
  })

  it('approves a prompt for a same-machine vault, flagged as loopback', () => {
    expect(canRequestConsent('http://localhost:8080/', ['127.0.0.1']))
      .toMatchObject({ ok: true, loopback: true })
  })

  it('refuses to prompt for metadata or the unspecified address', () => {
    expect(canRequestConsent('https://169.254.169.254/', ['169.254.169.254']).ok).toBe(false)
    expect(canRequestConsent('http://0.0.0.0:8443/', ['0.0.0.0']).ok).toBe(false)
  })

  it('refuses to prompt for an address that needs no permission', () => {
    const result = canRequestConsent('https://vault.example.com/', ['203.0.113.10'])
    expect(result).toEqual({ ok: false, reason: 'This address does not need permission.' })
  })
})

describe('formatHostKey', () => {
  it('renders the origin the dialog and settings list show', () => {
    expect(formatHostKey({ host: 'vault.example.com', protocol: 'https:', port: '' }))
      .toBe('https://vault.example.com')
    expect(formatHostKey({ host: 'vault.example.com', protocol: 'https:', port: '8443' }))
      .toBe('https://vault.example.com:8443')
    expect(formatHostKey({ host: '192.168.1.50', protocol: 'http:', port: '8080' }))
      .toBe('http://192.168.1.50:8080')
  })

  it('puts the brackets back on an IPv6 literal', () => {
    expect(formatHostKey({ host: 'fd7a:115c:a1e0::1', protocol: 'https:', port: '8443' }))
      .toBe('https://[fd7a:115c:a1e0::1]:8443')
  })
})

describe('sanitizeConsentLabels', () => {
  it('falls back to English for a missing or unusable payload', () => {
    expect(sanitizeConsentLabels(undefined)).toEqual(DEFAULT_CONSENT_LABELS)
    expect(sanitizeConsentLabels(null)).toEqual(DEFAULT_CONSENT_LABELS)
    expect(sanitizeConsentLabels('nope')).toEqual(DEFAULT_CONSENT_LABELS)
    expect(sanitizeConsentLabels({})).toEqual(DEFAULT_CONSENT_LABELS)
  })

  it('takes the translated strings it is given', () => {
    const labels = sanitizeConsentLabels({
      allow: 'Zulassen', cancel: 'Abbrechen', warningLoopback: 'Dienst auf diesem Computer.',
    })
    expect(labels.allow).toBe('Zulassen')
    expect(labels.cancel).toBe('Abbrechen')
    expect(labels.warningLoopback).toBe('Dienst auf diesem Computer.')
    // Untranslated fields keep the default rather than going blank.
    expect(labels.title).toBe(DEFAULT_CONSENT_LABELS.title)
  })

  it('falls back per field for a non-string, empty, or over-long value', () => {
    const labels = sanitizeConsentLabels({
      allow: 42,
      cancel: '   ',
      title: 'x'.repeat(401),
      scope: 'x'.repeat(400),
    })
    expect(labels.allow).toBe(DEFAULT_CONSENT_LABELS.allow)
    expect(labels.cancel).toBe(DEFAULT_CONSENT_LABELS.cancel)
    expect(labels.title).toBe(DEFAULT_CONSENT_LABELS.title)
    expect(labels.scope).toBe('x'.repeat(400)) // exactly at the cap is fine
  })

  it('strips control characters, so a label cannot scroll the origin out of view', () => {
    const labels = sanitizeConsentLabels({ warning: 'Safe\n\n\n\n\n\n\n\n\n\nlooking' })
    expect(labels.warning).toBe('Safe looking')
    expect(labels.warning).not.toContain('\n')
  })

  it('ignores keys that are not part of the dialog', () => {
    const labels = sanitizeConsentLabels({ __proto__: { allow: 'pwned' }, detail: 'extra' })
    expect(labels).toEqual(DEFAULT_CONSENT_LABELS)
    expect(Object.keys(labels).sort()).toEqual(Object.keys(DEFAULT_CONSENT_LABELS).sort())
  })
})
