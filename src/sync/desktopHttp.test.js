import { afterEach, describe, it, expect, vi } from 'vitest'

// The desktop app's HTTP (docs/desktop-app.md, "Sync through the main
// process"): the page makes no request of its own, so WebDAV, intents and the
// vault go through `window.lifeGlanceDesktop.http`. Capacitor reads 'web'
// there, as it does in the real desktop app.

const h = vi.hoisted(() => ({ capHttp: vi.fn() }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web', isPluginAvailable: () => false },
  CapacitorHttp: { request: h.capHttp },
  registerPlugin: () => ({}),
}))

const { desktopHttpRequest, hasNativeHttp, isNativePlatform, nativeRequest, nativeWebdavFetch, nativeWebdavResponse } = await import('./nativeHttp.js')
const { desktopVaultFetchImpl, makeDesktopVaultFetch, nativeVaultFetchImpl } = await import('./nativeVaultFetch.js')
const { detectSseTransport } = await import('./vaultEventStream.js')
const { rowStamp, ownWriterEntry } = await import('./writerStamp.js')

function desktop(request) {
  const http = { request: vi.fn(request) }
  vi.stubGlobal('window', { lifeGlanceDesktop: { info: { platform: 'linux' }, shell: { setTheme() {} }, http } })
  return http
}
afterEach(() => { vi.unstubAllGlobals(); h.capHttp.mockReset() })

describe('where requests go', () => {
  it('on the web: no native HTTP, and the vault keeps the platform fetch', () => {
    expect(hasNativeHttp()).toBe(false)
    expect(nativeVaultFetchImpl()).toBeUndefined()
    expect(desktopVaultFetchImpl()).toBeUndefined()
  })

  it('in the desktop app: native HTTP without being a Capacitor shell', () => {
    desktop(async () => ({ status: 200, statusText: 'OK', body: '', headers: {} }))
    expect(isNativePlatform()).toBe(false)   // export, share sheets and the like stay the web's
    expect(hasNativeHttp()).toBe(true)
    expect(typeof nativeVaultFetchImpl()).toBe('function')
    expect(typeof desktopVaultFetchImpl()).toBe('function')
  })
})

describe('WebDAV through the main process', () => {
  it('sends the request as it is, and never touches CapacitorHttp', async () => {
    const http = desktop(async () => ({ status: 207, statusText: 'Multi-Status', body: '<multistatus/>', headers: { etag: 'W/"abc-gzip"' } }))
    const r = await nativeRequest('PROPFIND', 'https://dav.example.com/x/', { Authorization: 'Basic z', Depth: '1' }, '<propfind/>')
    expect(http.request).toHaveBeenCalledWith('PROPFIND', 'https://dav.example.com/x/', { 'Accept-Encoding': 'identity', Authorization: 'Basic z', Depth: '1' }, '<propfind/>', undefined)
    expect(r).toEqual({ status: 207, ok: true, etag: '"abc"', body: '<multistatus/>' })
    expect(h.capHttp).not.toHaveBeenCalled()
  })

  it('answers the sync engine and the intents transport in their own shapes', async () => {
    desktop(async () => ({ status: 200, statusText: 'OK', body: '{"a":1}', headers: { etag: '"e1"' } }))
    expect(await nativeWebdavFetch('GET', 'https://dav.example.com/f.json', {}, null)).toEqual({ status: 200, ok: true, statusText: '', headers: { etag: '"e1"' }, body: '{"a":1}' })
    const res = await nativeWebdavResponse('GET', 'https://dav.example.com/f.json', {}, null)
    expect([res.ok, res.status, await res.text(), await res.json()]).toEqual([true, 200, '{"a":1}', { a: 1 }])
  })

  it('a request that got no response throws, as on the phones, with the shell\'s reason', async () => {
    desktop(async () => ({ error: 'Private/reserved address' }))
    await expect(nativeRequest('GET', 'http://192.168.1.10/dav', {}, null)).rejects.toThrow('Private/reserved address')
    desktop(async () => undefined)
    await expect(nativeRequest('GET', 'https://dav.example.com/', {}, null)).rejects.toThrow('No answer from the desktop app')
  })

  it('reports an HTTP error status as a status, not a throw', async () => {
    desktop(async () => ({ status: 412, statusText: 'Precondition Failed', body: '', headers: {} }))
    expect(await nativeRequest('PUT', 'https://dav.example.com/f.json', { 'If-Match': '"old"' }, '{}')).toMatchObject({ status: 412, ok: false, etag: null })
  })
})

describe('the vault through the main process', () => {
  it('maps a JSON call onto the fetch shape the vault client reads', async () => {
    const http = { request: vi.fn(async () => ({ status: 200, statusText: 'OK', body: '{"salt":"abc"}', headers: { 'retry-after': '3' } })) }
    const res = await makeDesktopVaultFetch(http)('https://vault.example.com/salt/acct', { method: 'GET', headers: { Authorization: 'Bearer t' } })
    expect(http.request).toHaveBeenCalledWith('GET', 'https://vault.example.com/salt/acct', { Authorization: 'Bearer t' }, null, undefined)
    expect([res.ok, res.status, res.headers.get('Retry-After')]).toEqual([true, 200, '3'])
    expect(await res.json()).toEqual({ salt: 'abc' })
    expect(await res.text()).toBe('{"salt":"abc"}')
  })

  it('defaults to GET with no headers and no body', async () => {
    const http = { request: vi.fn(async () => ({ status: 404, statusText: 'Not Found', body: '', headers: {} })) }
    const res = await makeDesktopVaultFetch(http)('https://vault.example.com/healthz')
    expect(http.request).toHaveBeenCalledWith('GET', 'https://vault.example.com/healthz', {}, null, undefined)
    expect([res.ok, res.status]).toEqual([false, 404])
  })

  it('sends a media part as bytes, with no base64 on the way', async () => {
    const http = { request: vi.fn(async () => ({ status: 200, statusText: 'OK', body: '{"ok":true}', headers: {} })) }
    const f = makeDesktopVaultFetch(http)
    const part = new Uint8Array([0, 255, 16])
    await f('https://vault.example.com/blobs/h/parts/1', { method: 'PUT', body: part })
    expect(http.request.mock.calls[0][3]).toBe(part)
    await f('https://vault.example.com/blobs/h/parts/2', { method: 'PUT', body: part.buffer })
    expect(http.request.mock.calls[1][3]).toBeInstanceOf(Uint8Array)
    expect([...http.request.mock.calls[1][3]]).toEqual([0, 255, 16])
  })

  it('asks for bytes on a download, and hands back exactly those bytes', async () => {
    // A view into a larger buffer, as IPC may deliver it.
    const backing = new Uint8Array([9, 9, 0, 159, 146, 255, 9])
    const http = { request: vi.fn(async () => ({ status: 206, statusText: '', body: backing.subarray(2, 6), headers: { 'content-range': 'bytes 0-3/4' } })) }
    const res = await makeDesktopVaultFetch(http)('https://vault.example.com/blobs/h', { headers: { Range: 'bytes=0-3' }, responseType: 'arraybuffer' })
    expect(http.request.mock.calls[0][4]).toEqual({ binary: true })
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0, 159, 146, 255])
    expect(res.headers.get('content-range')).toBe('bytes 0-3/4')
  })

  it('reads an error body as text even when bytes were asked for', async () => {
    const http = { request: async () => ({ status: 409, statusText: 'Conflict', body: new TextEncoder().encode('{"error":"hash mismatch"}'), headers: {} }) }
    const res = await makeDesktopVaultFetch(http)('https://vault.example.com/blobs/h', { responseType: 'arraybuffer' })
    expect(res.ok).toBe(false)
    expect(await res.json()).toEqual({ error: 'hash mismatch' })
  })

  it('rejects when the main process got no response', async () => {
    const f = makeDesktopVaultFetch({ request: async () => ({ error: 'The server did not respond within 30 s' }) })
    await expect(f('https://vault.example.com/salt/a')).rejects.toThrow('did not respond')
  })
})

describe('desktopHttpRequest', () => {
  it('passes the options through and returns the response', async () => {
    const http = { request: vi.fn(async () => ({ status: 200, statusText: 'OK', body: 'x', headers: {} })) }
    expect(await desktopHttpRequest(http, 'GET', 'https://a.example.com/', undefined, undefined, { binary: true })).toMatchObject({ status: 200, body: 'x' })
    expect(http.request).toHaveBeenCalledWith('GET', 'https://a.example.com/', {}, null, { binary: true })
  })
})

describe('the desktop app elsewhere in sync', () => {
  it('reads GLANCEvault\'s push through the shell, as the phones do', () => {
    expect(detectSseTransport()).toBe('none')                      // no window: nothing to stream into
    desktop(async () => ({}))
    expect(detectSseTransport()).toBe('native-bridge')
  })

  it('stamps what it writes as the desktop app, not a web browser', () => {
    expect(rowStamp('d1').platform).toBe('web')
    desktop(async () => ({}))
    expect(rowStamp('d1').platform).toBe('desktop')
    expect(ownWriterEntry().platform).toBe('desktop')
  })
})
