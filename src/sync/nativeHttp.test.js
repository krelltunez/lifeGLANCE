import { describe, it, expect, beforeEach, vi } from 'vitest'

// Shared, hoisted so the @capacitor/core mock factory can close over them.
const h = vi.hoisted(() => ({ platform: 'android', capHttp: vi.fn(), webdav: vi.fn() }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => h.platform },
  CapacitorHttp: { request: h.capHttp },
  registerPlugin: () => ({ request: h.webdav }),
}))

// normalizeEtag is the REAL implementation from @glance-apps/sync.
const { nativeRequest, nativeWebdavFetch } = await import('./nativeHttp.js')

beforeEach(() => {
  h.capHttp.mockReset()
  h.webdav.mockReset()
  h.platform = 'android'
})

describe('nativeHttp transport (#232 ETag / #233 verbs)', () => {
  it('sends Accept-Encoding: identity to stop mod_deflate mangling the ETag', async () => {
    h.capHttp.mockResolvedValue({ status: 200, headers: { ETag: '"abc"' }, data: '{}' })
    await nativeRequest('GET', 'https://dav/x', { Authorization: 'Basic z' })
    expect(h.capHttp.mock.calls[0][0].headers['Accept-Encoding']).toBe('identity')
  })

  it('caller Accept-Encoding overrides the identity default', async () => {
    h.capHttp.mockResolvedValue({ status: 200, headers: {}, data: '' })
    await nativeRequest('GET', 'https://dav/x', { 'Accept-Encoding': 'gzip' })
    expect(h.capHttp.mock.calls[0][0].headers['Accept-Encoding']).toBe('gzip')
  })

  it('normalizes a weak + -gzip-mangled ETag read from a case-varied header', async () => {
    h.capHttp.mockResolvedValue({ status: 200, headers: { Etag: 'W/"abc-gzip"' }, data: '{}' })
    const r = await nativeRequest('GET', 'https://dav/x', {})
    expect(r.etag).toBe('"abc"')
  })

  it('leaves a clean ETag untouched and passes a missing one through as null', async () => {
    h.capHttp.mockResolvedValueOnce({ status: 200, headers: { etag: '"clean"' }, data: '' })
    expect((await nativeRequest('GET', 'https://dav/x', {})).etag).toBe('"clean"')
    h.capHttp.mockResolvedValueOnce({ status: 200, headers: {}, data: '' })
    expect((await nativeRequest('GET', 'https://dav/x', {})).etag).toBe(null)
  })

  it('routes PROPFIND through the OkHttp plugin on Android', async () => {
    h.webdav.mockResolvedValue({ status: 207, headers: {}, data: '<multistatus/>' })
    const r = await nativeRequest('PROPFIND', 'https://dav/dir/', {}, '<propfind/>')
    expect(h.webdav).toHaveBeenCalledTimes(1)
    expect(h.capHttp).not.toHaveBeenCalled()
    expect(r.status).toBe(207)
  })

  it('routes MKCOL through the OkHttp plugin on Android', async () => {
    h.webdav.mockResolvedValue({ status: 201, headers: {}, data: '' })
    await nativeRequest('MKCOL', 'https://dav/dir/', {})
    expect(h.webdav).toHaveBeenCalledTimes(1)
    expect(h.capHttp).not.toHaveBeenCalled()
  })

  it('keeps core verbs (GET/PUT/DELETE) on CapacitorHttp', async () => {
    h.capHttp.mockResolvedValue({ status: 200, headers: {}, data: '' })
    for (const m of ['GET', 'PUT', 'DELETE']) await nativeRequest(m, 'https://dav/x', {}, 'b')
    expect(h.capHttp).toHaveBeenCalledTimes(3)
    expect(h.webdav).not.toHaveBeenCalled()
  })

  it('on iOS, PROPFIND stays on CapacitorHttp (URLSession accepts any verb)', async () => {
    h.platform = 'ios'
    h.capHttp.mockResolvedValue({ status: 207, headers: {}, data: '<x/>' })
    await nativeRequest('PROPFIND', 'https://dav/dir/', {})
    expect(h.capHttp).toHaveBeenCalledTimes(1)
    expect(h.webdav).not.toHaveBeenCalled()
  })

  it('nativeWebdavFetch matches the electronProxyFetch contract with a normalized etag', async () => {
    h.capHttp.mockResolvedValue({ status: 200, headers: { etag: 'W/"v1"' }, data: '{"a":1}' })
    const r = await nativeWebdavFetch('GET', 'https://dav/x', {})
    expect(r).toMatchObject({ status: 200, ok: true, statusText: '', headers: { etag: '"v1"' }, body: '{"a":1}' })
  })
})
