import { describe, it, expect, vi } from 'vitest'
import { blockedMessage, checkPrivateAddress, consentLabels, grantPrivateAddress } from './privateAddress.js'

const t = (key, vars) => (vars ? `${key}(${vars.origin})` : key)

describe('checkPrivateAddress', () => {
  it('is null off the desktop, and for no URL', async () => {
    expect(await checkPrivateAddress('http://192.168.1.10/dav', null)).toBeNull()
    const http = { inspect: vi.fn() }
    expect(await checkPrivateAddress('', http)).toBeNull()
    expect(await checkPrivateAddress(null, http)).toBeNull()
    expect(http.inspect).not.toHaveBeenCalled()
  })

  it('is null for a server the desktop will reach', async () => {
    expect(await checkPrivateAddress('https://dav.example.com/', { inspect: async () => ({ blocked: false }) })).toBeNull()
  })

  it('names a blocked origin, and whether a grant could unlock it', async () => {
    const grantable = { inspect: async () => ({ blocked: true, canGrant: true, origin: 'http://192.168.1.10:8080', addresses: ['192.168.1.10'] }) }
    expect(await checkPrivateAddress('http://192.168.1.10:8080/dav', grantable)).toEqual({ origin: 'http://192.168.1.10:8080', canGrant: true })
    const never = { inspect: async () => ({ blocked: true, canGrant: false, origin: 'http://169.254.169.254', reason: 'x' }) }
    expect(await checkPrivateAddress('http://169.254.169.254/', never)).toEqual({ origin: 'http://169.254.169.254', canGrant: false })
  })

  it('is a diagnostic, never a gate: a failed check reads as not blocked', async () => {
    expect(await checkPrivateAddress('http://nas.local/', { inspect: async () => { throw new Error('ipc closed') } })).toBeNull()
    expect(await checkPrivateAddress('http://nas.local/', { inspect: async () => undefined })).toBeNull()
  })
})

describe('blockedMessage', () => {
  it('says permission is needed, or that the address is refused for good', () => {
    expect(blockedMessage(t, { origin: 'http://nas.local', canGrant: true })).toBe('privateAddress.needsPermission(http://nas.local)')
    expect(blockedMessage(t, { origin: 'http://169.254.1.1', canGrant: false })).toBe('privateAddress.refused(http://169.254.1.1)')
  })
})

describe('grantPrivateAddress', () => {
  it('sends the translated dialog text, with the loopback warning for the kind of server', async () => {
    const http = { grant: vi.fn(async () => ({ ok: true })) }
    expect(await grantPrivateAddress(t, 'http://localhost:8080', 'vault', http)).toBeNull()
    expect(http.grant).toHaveBeenCalledWith('http://localhost:8080', consentLabels(t, 'vault'))
    expect(consentLabels(t, 'vault').warningLoopback).toBe('privateAddress.consentWarningLoopbackVault')
    expect(consentLabels(t, 'server').warningLoopback).toBe('privateAddress.consentWarningLoopbackServer')
    expect(Object.keys(consentLabels(t, 'server')).sort()).toEqual(['allow', 'cancel', 'question', 'resolvesTo', 'scope', 'title', 'warning', 'warningLoopback'])
  })

  it('answers the reason when declined, and a plain message when there is none', async () => {
    expect(await grantPrivateAddress(t, 'http://nas.local', 'server', { grant: async () => ({ ok: false, reason: 'Permission declined.' }) })).toBe('Permission declined.')
    expect(await grantPrivateAddress(t, 'http://nas.local', 'server', { grant: async () => ({ ok: false }) })).toBe('privateAddress.grantFailed')
    expect(await grantPrivateAddress(t, 'http://nas.local', 'server', { grant: async () => { throw new Error('x') } })).toBe('privateAddress.grantFailed')
    expect(await grantPrivateAddress(t, 'http://nas.local', 'server', null)).toBe('privateAddress.grantFailed')
  })
})
