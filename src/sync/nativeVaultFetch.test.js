// Tests for the native-safe vault fetch adapter.
//
// The real CapacitorHttp path runs on-device only, so these cover the adapter
// LOGIC with a fake CapacitorHttp-shaped primitive: text mapping (.ok/.status/
// .json()/.text()), the BINARY request body (base64 + dataType 'file') and
// BINARY response (arraybuffer/base64 → bytes) that fix native blob upload/
// download, and the web-vs-native gating.

import { describe, it, expect, vi } from 'vitest'
import { makeNativeVaultFetch, nativeVaultFetchImpl } from './nativeVaultFetch.js'

// Fake CapacitorHttp: records the request opts and returns a canned response
// `{ status, data, headers }` (the real plugin's shape).
function fakeHttp(response, captured) {
  return async (opts) => {
    if (captured) Object.assign(captured, opts)
    return typeof response === 'function' ? response(opts) : response
  }
}
const b64 = (bytes) => Buffer.from(bytes).toString('base64')

describe('makeNativeVaultFetch — text / control-plane mapping', () => {
  it('maps .ok/.status and parses .json()/.text() from a text response', async () => {
    const captured = {}
    const f = makeNativeVaultFetch(fakeHttp({ status: 200, data: '{"salt":"abc"}', headers: {} }, captured))
    const res = await f('https://vault/salt/acct', { method: 'GET', headers: { Authorization: 'Bearer t' } })
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ salt: 'abc' })
    expect(await res.text()).toBe('{"salt":"abc"}')
    expect(captured.responseType).toBe('text') // non-binary read
    expect(captured.method).toBe('GET')
    expect(captured.url).toBe('https://vault/salt/acct')
    expect(captured.dataType).toBeUndefined()
  })

  it('passes a string (JSON) body straight through as opts.data with no dataType', async () => {
    const captured = {}
    const f = makeNativeVaultFetch(fakeHttp({ status: 200, data: '{}', headers: {} }, captured))
    await f('https://vault/blobs/uploads', { method: 'POST', headers: {}, body: '{"hash":"h"}' })
    expect(captured.data).toBe('{"hash":"h"}')
    expect(captured.dataType).toBeUndefined()
  })

  it('derives .ok from status; a 404 error body stays a plain string', async () => {
    const bad = makeNativeVaultFetch(fakeHttp({ status: 404, data: 'not found', headers: {} }))
    const res = await bad('u', { responseType: 'arraybuffer' }) // even a binary read: error body is text
    expect(res.ok).toBe(false)
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('not found') // NOT base64-decoded
  })

  it('exposes a case-insensitive headers.get for etag', async () => {
    const f = makeNativeVaultFetch(fakeHttp({ status: 200, data: '{}', headers: { ETag: 'W/"v1"' } }))
    const res = await f('u', {})
    expect(res.headers.get('etag')).toBe('W/"v1"')
    expect(res.headers.get('x-other')).toBeNull()
  })
})

describe('makeNativeVaultFetch — binary (the native blob upload/download fix)', () => {
  it('REQUEST: a Uint8Array body is base64-encoded and marked dataType "file"', async () => {
    const captured = {}
    const f = makeNativeVaultFetch(fakeHttp({ status: 200, data: '', headers: {} }, captured))
    const payload = new Uint8Array([0, 1, 2, 250, 255]) // includes non-UTF8 bytes
    await f('https://vault/blobs/uploads/x/parts/0', { method: 'PUT', headers: {}, body: payload })
    expect(captured.dataType).toBe('file') // native Base64-decodes → raw bytes
    expect(captured.data).toBe(b64(payload)) // exact base64 of the bytes
    expect(captured.responseType).toBe('text')
  })

  it('REQUEST: an ArrayBuffer body is handled the same way', async () => {
    const captured = {}
    const f = makeNativeVaultFetch(fakeHttp({ status: 200, data: '', headers: {} }, captured))
    const payload = new Uint8Array([9, 8, 7])
    await f('u', { method: 'PUT', body: payload.buffer })
    expect(captured.dataType).toBe('file')
    expect(captured.data).toBe(b64(payload))
  })

  it('RESPONSE: an arraybuffer read base64-decodes res.data back to the exact bytes', async () => {
    const original = new Uint8Array([12, 0, 200, 5, 255, 128])
    const captured = {}
    const f = makeNativeVaultFetch(fakeHttp({ status: 200, data: b64(original), headers: {} }, captured))
    const res = await f('https://vault/blobs/deadbeef', { method: 'GET', responseType: 'arraybuffer' })
    expect(captured.responseType).toBe('arraybuffer')
    const out = new Uint8Array(await res.arrayBuffer())
    expect(out).toEqual(original) // round-trips byte-for-byte
  })

  it('round-trip: upload bytes then download them back through the adapter', async () => {
    const bytes = new Uint8Array([1, 2, 3, 254, 0, 77])
    // Upload: capture what the adapter sent as base64.
    const up = {}
    await makeNativeVaultFetch(fakeHttp({ status: 200, data: '', headers: {} }, up))(
      'u', { method: 'PUT', body: bytes },
    )
    // The server would store exactly those bytes; a download returns them base64.
    const res = await makeNativeVaultFetch(fakeHttp({ status: 200, data: up.data, headers: {} }))(
      'u', { method: 'GET', responseType: 'arraybuffer' },
    )
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
  })
})

describe('nativeVaultFetchImpl — web vs native gating', () => {
  it('returns undefined on web (non-native) so callers keep global fetch', () => {
    expect(nativeVaultFetchImpl()).toBeUndefined()
  })

  it('returns a working adapter on native (over a mocked CapacitorHttp)', async () => {
    vi.resetModules()
    vi.doMock('./nativeHttp.js', () => ({ isNativePlatform: () => true }))
    vi.doMock('@capacitor/core', () => ({
      CapacitorHttp: { request: async () => ({ status: 200, data: '{"ok":1}', headers: {} }) },
    }))
    const { nativeVaultFetchImpl: impl } = await import('./nativeVaultFetch.js')
    const f = impl()
    expect(typeof f).toBe('function')
    expect(await (await f('u', {})).json()).toEqual({ ok: 1 })
    vi.doUnmock('@capacitor/core')
    vi.doUnmock('./nativeHttp.js')
    vi.resetModules()
  })
})

describe('wiring — injection sites, undefined on web', () => {
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
    expect(seenFetchImpl).toBeUndefined() // web → package uses global fetch
  })

  it('blob transport uses global fetch on web (adapter undefined)', async () => {
    const { blobExists } = await import('../blobs/blobTransport.js')
    const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) })
    const exists = await blobExists('deadbeef', {
      connection: { vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' },
      fetchImpl,
    })
    expect(exists).toBe(false)
  })
})
