import { describe, it, expect } from 'vitest'
import { assertSafeUrl, SsrfError } from './ssrfGuard.js'

// All targets use IP literals or malformed input, so dns.lookup resolves them
// locally (no network) and the suite is deterministic offline.

async function verdict(target) {
  try {
    await assertSafeUrl(target)
    return 'allow'
  } catch (err) {
    if (err instanceof SsrfError) return 'block'
    throw err
  }
}

describe('assertSafeUrl SSRF guard', () => {
  const blocked = [
    ['loopback', 'http://127.0.0.1/dav'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['hex-encoded loopback', 'http://0x7f000001/'],
    ['decimal-encoded loopback', 'http://2130706433/'],
    ['octal-encoded loopback', 'http://0177.0.0.1/'],
    ['RFC1918 10/8', 'http://10.5.6.7/'],
    ['RFC1918 192.168/16', 'http://192.168.1.1/'],
    ['RFC1918 172.16/12', 'http://172.16.9.9/'],
    ['CGNAT 100.64/10', 'http://100.100.0.1/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['IPv6 ULA fc00::/7', 'http://[fd00::1]/'],
    ['IPv6 link-local', 'http://[fe80::1]/'],
    ['IPv4-mapped private (dotted)', 'http://[::ffff:10.0.0.1]/'],
    ['IPv4-mapped metadata (hex form)', 'http://[::ffff:169.254.169.254]/'],
    ['non-http scheme', 'ftp://8.8.8.8/'],
    ['malformed URL', 'not a url'],
  ]
  for (const [name, target] of blocked) {
    it(`blocks ${name}`, async () => {
      expect(await verdict(target)).toBe('block')
    })
  }

  const allowed = [
    ['public IPv4', 'http://8.8.8.8/'],
    ['public IPv4 (TLS)', 'https://1.1.1.1/dav/'],
    ['public IPv6', 'http://[2606:4700:4700::1111]/'],
  ]
  for (const [name, target] of allowed) {
    it(`allows ${name}`, async () => {
      expect(await verdict(target)).toBe('allow')
    })
  }

  it('rejects with the right status codes', async () => {
    await expect(assertSafeUrl('http://10.0.0.1/')).rejects.toMatchObject({ status: 403 })
    await expect(assertSafeUrl('gopher://x/')).rejects.toMatchObject({ status: 400 })
  })

  describe('allowPrivate (self-host LAN)', () => {
    async function verdictPrivate(target) {
      try {
        await assertSafeUrl(target, { allowPrivate: true })
        return 'allow'
      } catch (err) {
        if (err instanceof SsrfError) return 'block'
        throw err
      }
    }

    const nowAllowed = [
      ['RFC1918 192.168/16 over http', 'http://192.168.1.50:5005/dav/'],
      ['RFC1918 10/8', 'http://10.0.0.5/'],
      ['RFC1918 172.16/12', 'https://172.16.9.9:5006/'],
      ['CGNAT', 'http://100.100.0.1/'],
      ['loopback', 'http://127.0.0.1:8080/'],
      ['IPv6 loopback', 'http://[::1]/'],
      ['IPv6 ULA', 'http://[fd00::1]/'],
    ]
    for (const [name, target] of nowAllowed) {
      it(`allows ${name} when allowPrivate`, async () => {
        expect(await verdictPrivate(target)).toBe('allow')
      })
    }

    // Metadata / link-local / reserved stay blocked even with allowPrivate — no
    // legitimate NAS lives there and it's the highest-value SSRF target.
    const stillBlocked = [
      ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
      ['metadata via IPv4-mapped IPv6', 'http://[::ffff:169.254.169.254]/'],
      ['IPv6 link-local', 'http://[fe80::1]/'],
      ['multicast', 'http://224.0.0.1/'],
    ]
    for (const [name, target] of stillBlocked) {
      it(`still blocks ${name} even when allowPrivate`, async () => {
        expect(await verdictPrivate(target)).toBe('block')
      })
    }
  })
})
