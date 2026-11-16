import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createNetworkTrust } from './networkTrust.js'

const DNS = {
  'dav.example.com': ['93.184.216.34'],
  'nas.home.arpa': ['192.168.1.20'],
  'vault.tailnet.js.net': ['100.101.102.103'],
  'mixed.example.com': ['93.184.216.34', '10.0.0.5'],
  'meta.example.com': ['169.254.169.254'],
}

let dir
let grantsFile
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeglance-trust-'))
  grantsFile = path.join(dir, 'proxy-trusted-hosts.json')
})
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

function trust(answer = true) {
  const confirm = vi.fn(async () => answer)
  const resolve = vi.fn(async (host) => {
    if (/^[\d.]+$/.test(host) || host.includes(':')) return [host.replace(/^\[|\]$/g, '')]
    const found = DNS[host]
    if (!found) throw new Error('ENOTFOUND')
    return found
  })
  return { t: createNetworkTrust({ grantsFile, resolve, confirm, now: () => new Date('2026-11-09T12:00:00Z') }), confirm }
}

describe('networkTrust.validate', () => {
  it('lets a public server through', async () => {
    await expect(trust().t.validate('https://dav.example.com/remote.php/dav/')).resolves.toBeUndefined()
  })

  it('refuses a private server until granted', async () => {
    await expect(trust().t.validate('https://nas.home.arpa/dav/')).rejects.toThrow('Private/reserved address')
  })

  it('refuses a public name that also resolves to a private address', async () => {
    await expect(trust().t.validate('https://mixed.example.com/')).rejects.toThrow()
  })

  it('refuses non-http schemes and DNS failures', async () => {
    await expect(trust().t.validate('file:///etc/passwd')).rejects.toThrow()
    await expect(trust().t.validate('https://nowhere.invalid/')).rejects.toThrow('DNS resolution failed')
  })
})

describe('granting a private server', () => {
  it('asks, then lets that exact origin through, and remembers it across restarts', async () => {
    const { t, confirm } = trust(true)
    expect(await t.request('https://nas.home.arpa/dav/', {})).toEqual({ ok: true })
    const dialog = confirm.mock.calls[0][0]
    expect(dialog.message).toContain('https://nas.home.arpa')
    expect(dialog.detail).toContain('192.168.1.20')
    await expect(t.validate('https://nas.home.arpa/dav/sub')).resolves.toBeUndefined()

    const restarted = trust().t
    await expect(restarted.validate('https://nas.home.arpa/other')).resolves.toBeUndefined()
    expect(restarted.list()).toEqual([
      { origin: 'https://nas.home.arpa', grantedAt: '2026-11-09T12:00:00.000Z', addresses: ['192.168.1.20'] },
    ])
  })

  it('grants per scheme and port, never the whole host', async () => {
    const { t } = trust(true)
    await t.request('https://nas.home.arpa/dav/', {})
    await expect(t.validate('http://nas.home.arpa/dav/')).rejects.toThrow()
    await expect(t.validate('https://nas.home.arpa:8443/')).rejects.toThrow()
  })

  it('never lets a redirect into a granted address through', async () => {
    const { t } = trust(true)
    await t.request('https://nas.home.arpa/', {})
    await expect(t.validate('https://nas.home.arpa/', true)).rejects.toThrow()
  })

  it('records nothing when the user declines', async () => {
    const { t } = trust(false)
    expect(await t.request('https://vault.tailnet.js.net/', {})).toEqual({ ok: false, reason: 'Permission declined.' })
    expect(t.list()).toEqual([])
    expect(fs.existsSync(grantsFile)).toBe(false)
  })

  it('never offers a grant for link-local (cloud metadata) addresses', async () => {
    const { t, confirm } = trust(true)
    expect((await t.request('http://meta.example.com/latest/', {})).ok).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('keeps the origin and addresses in the dialog whatever labels arrive', async () => {
    const { t, confirm } = trust(true)
    await t.request('https://nas.home.arpa/', { question: 'Fine?\n\n\n\n\n\n\n\n', resolvesTo: 42, allow: '' })
    const dialog = confirm.mock.calls[0][0]
    expect(dialog.message).toMatch(/Fine\?\n\nhttps:\/\/nas\.home\.arpa$/)
    expect(dialog.detail).toContain('192.168.1.20')
    expect(dialog.allow).toBe('Allow')
  })

  it('uses the loopback warning for this machine', async () => {
    const { t, confirm } = trust(true)
    await t.request('http://127.0.0.1:8080/', { warning: 'LAN', warningLoopback: 'THIS MACHINE' })
    expect(confirm.mock.calls[0][0].detail).toContain('THIS MACHINE')
    expect(confirm.mock.calls[0][0].message).toContain('http://127.0.0.1:8080')
  })

  it('revokes a grant', async () => {
    const { t } = trust(true)
    await t.request('https://nas.home.arpa/', {})
    expect(t.revoke('https://nas.home.arpa')).toEqual({ ok: true })
    await expect(t.validate('https://nas.home.arpa/')).rejects.toThrow()
    expect(trust().t.list()).toEqual([])
  })

  it('starts with no grants when the file is corrupt', async () => {
    fs.writeFileSync(grantsFile, '{ not json')
    const { t } = trust()
    expect(t.list()).toEqual([])
    await expect(t.validate('https://nas.home.arpa/')).rejects.toThrow()
  })
})

describe('networkTrust.inspect', () => {
  it('says what blocks a URL and whether a grant can unlock it', async () => {
    const { t } = trust()
    expect(await t.inspect('https://dav.example.com/')).toEqual({ blocked: false })
    expect(await t.inspect('https://nas.home.arpa/dav/')).toEqual({
      blocked: true, canGrant: true, origin: 'https://nas.home.arpa', addresses: ['192.168.1.20'],
    })
    expect(await t.inspect('http://meta.example.com/')).toMatchObject({ blocked: true, canGrant: false, origin: 'http://meta.example.com' })
    expect(await t.inspect('https://nowhere.invalid/')).toEqual({ blocked: false })
  })
})
