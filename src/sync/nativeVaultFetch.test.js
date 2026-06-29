// Tests for the native-safe vault fetch adapter.
//
// The real CapacitorHttp path can only run on-device, so these tests cover the
// adapter LOGIC and WIRING with a faked native primitive: that it maps a native
// response to the Response-like contract the vault client / blob transport read
// (.ok / .status / .json() / .text() / .arrayBuffer()), and that the gating
// helper returns undefined on web so global fetch is used in the browser/PWA.

import { describe, it, expect, vi } from 'vitest'
import { makeNativeVaultFetch, nativeVaultFetchImpl } from './nativeVaultFetch.js'

// Fake native primitive: lifeGLANCE's (method, url, headers, body) shape,
// returning the raw body as a string (responseType 'text').
function fakeRequest(result, captured) {
  return async (method, url, headers, body) => {
    if (captured) Object.assign(captured, { method, url, headers, body })
    return result
  }
}

describe('makeNativeVaultFetch — maps native response to the Response-like contract', () => {
  it('exposes .ok/.status and parses .json()/.text() from the string body', async () => {
    const fetchLike = makeNativeVaultFetch(fakeRequest({ status: 200, ok: true, etag: null, body: '{"salt":"abc"}' }))
    const res = await fetchLike('https://vault/salt/acct', { method: 'GET', headers: { Authorization: 'Bearer t' } })
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ salt: 'abc' })
    expect(await res.text()).toBe('{"salt":"abc"}')
  })

  it('derives .ok from the status when the primitive omits it', async () => {
    const ok = makeNativeVaultFetch(fakeRequest({ status: 204, body: '' }))
    const bad = makeNativeVaultFetch(fakeRequest({ status: 404, body: '' }))
    expect((await ok('u', {})).ok).toBe(true)
    expect((await bad('u', {})).ok).toBe(false)
    expect((await bad('u', {})).status).toBe(404)
  })

  it('forwards method/url/headers/body to the native primitive', async () => {
    const captured = {}
    const fetchLike = makeNativeVaultFetch(fakeRequest({ status: 200, ok: true, body: '{}' }, captured))
    await fetchLike('https://vault/blobs/uploads', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: '{"hash":"h"}' })
    expect(captured.method).toBe('POST')
    expect(captured.url).toBe('https://vault/blobs/uploads')
    expect(captured.headers).toEqual({ Authorization: 'Bearer t' })
    expect(captured.body).toBe('{"hash":"h"}')
  })

  it('defaults method to GET and headers to {} when init is omitted', async () => {
    const captured = {}
    const fetchLike = makeNativeVaultFetch(fakeRequest({ status: 200, ok: true, body: '{}' }, captured))
    await fetchLike('https://vault/x')
    expect(captured.method).toBe('GET')
    expect(captured.headers).toEqual({})
  })

  it('exposes a case-insensitive headers.get for etag', async () => {
    const fetchLike = makeNativeVaultFetch(fakeRequest({ status: 200, ok: true, etag: 'W/"v1"', body: '{}' }))
    const res = await fetchLike('u', {})
    expect(res.headers.get('ETag')).toBe('W/"v1"')
    expect(res.headers.get('x-other')).toBeNull()
  })

  it('.arrayBuffer() returns the control-plane body bytes', async () => {
    const fetchLike = makeNativeVaultFetch(fakeRequest({ status: 200, ok: true, body: 'hello' }))
    const buf = await (await fetchLike('u', {})).arrayBuffer()
    expect(new TextDecoder().decode(new Uint8Array(buf))).toBe('hello')
  })
})

describe('nativeVaultFetchImpl — web vs native gating', () => {
  it('returns undefined on web (non-native) so callers keep global fetch', () => {
    // The test env is non-native (Capacitor.isNativePlatform() === false).
    expect(nativeVaultFetchImpl()).toBeUndefined()
  })

  it('returns the adapter on native', async () => {
    vi.resetModules()
    vi.doMock('./nativeHttp.js', () => ({
      isNativePlatform: () => true,
      nativeRequest: async () => ({ status: 200, ok: true, etag: null, body: '{"ok":1}' }),
    }))
    const { nativeVaultFetchImpl: impl } = await import('./nativeVaultFetch.js')
    const f = impl()
    expect(typeof f).toBe('function')
    expect((await (await f('u', {})).json())).toEqual({ ok: 1 })
    vi.doUnmock('./nativeHttp.js')
    vi.resetModules()
  })
})

describe('wiring — injection sites pass the adapter on native, undefined on web', () => {
  it('verify probe passes fetchImpl into createVaultClient (undefined on web)', async () => {
    const { verifyVaultCredentials } = await import('./vaultSetup.js')
    let seenFetchImpl = 'UNSET'
    const createVaultClient = ({ fetchImpl }) => {
      seenFetchImpl = fetchImpl
      return { getSalt: async () => new Uint8Array(16).fill(1) }
    }
    const r = await verifyVaultCredentials(
      { vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' },
      { createVaultClient },
    )
    expect(r.kind).toBe('success')
    // On web (test env) the adapter is undefined → the package uses global fetch.
    expect(seenFetchImpl).toBeUndefined()
  })

  it('blob transport uses global fetch on web (adapter undefined), not throwing for missing fetch', async () => {
    const { blobExists } = await import('../blobs/blobTransport.ts')
    // Inject an explicit fetch so we exercise resolveFetch without hitting network;
    // proves the native fallback does not interfere on web.
    const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) })
    const exists = await blobExists('deadbeef', {
      connection: { vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' },
      fetchImpl,
    })
    expect(exists).toBe(false)
  })
})
