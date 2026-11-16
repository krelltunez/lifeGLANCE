import { describe, expect, it, vi } from 'vitest'
import { BINARY_TIMEOUT_MS, createHttpProxy, MAX_REDIRECTS, REQUEST_TIMEOUT_MS } from './httpProxy.js'

const ok = (body = 'hello', headers = {}, status = 200) =>
  new Response(body, { status, headers })
const redirect = (status, location) => new Response(null, { status, headers: { location } })

function proxy(send, validate = vi.fn(async () => {}), timeoutMs) {
  return { request: createHttpProxy({ send, validate, timeoutMs }), validate }
}

describe('httpProxy request', () => {
  it('returns status, text body and lowercased headers', async () => {
    const send = vi.fn(async () => ok('<multistatus/>', { ETag: '"abc-gzip"', 'Content-Type': 'text/xml' }, 207))
    const { request } = proxy(send)
    expect(await request('propfind', 'https://dav.example.com/x/', { Depth: '1' }, null)).toEqual({
      status: 207,
      statusText: '',
      body: '<multistatus/>',
      headers: { etag: '"abc-gzip"', 'content-type': 'text/xml' },
    })
    const init = send.mock.calls[0][1]
    expect(init.method).toBe('PROPFIND')
    expect(init.headers).toEqual({ Depth: '1' })
    expect(init.redirect).toBe('manual')
    expect('body' in init).toBe(false)
  })

  it('refuses methods outside the list and malformed arguments, without sending', async () => {
    const send = vi.fn()
    const { request } = proxy(send)
    expect(await request('TRACE', 'https://a.example.com/', {}, null)).toEqual({ error: 'Method not allowed: TRACE' })
    expect(await request('GET', 42, {}, null)).toEqual({ error: 'Invalid URL' })
    expect(await request('PUT', 'https://a.example.com/', {}, { not: 'a body' })).toEqual({ error: 'Only text and byte bodies are supported' })
    expect(send).not.toHaveBeenCalled()
  })

  it('reports a refused URL as an error, not an HTTP status, and never sends it', async () => {
    const send = vi.fn()
    const { request } = proxy(send, vi.fn(async () => { throw new Error('Private/reserved address') }))
    expect(await request('GET', 'https://192.168.1.10/', {}, null)).toEqual({ error: 'Private/reserved address' })
    expect(send).not.toHaveBeenCalled()
  })

  it('checks every redirect hop, marked as a redirect', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(redirect(302, 'http://127.0.0.1/admin'))
    const validate = vi.fn(async (_url, isRedirect) => {
      if (isRedirect) throw new Error('Redirect to a private address')
    })
    const { request } = proxy(send, validate)
    expect(await request('GET', 'https://public.example.com/', {}, null)).toEqual({ error: 'Redirect to a private address' })
    expect(validate).toHaveBeenLastCalledWith('http://127.0.0.1/admin', true)
    expect(send).toHaveBeenCalledOnce()
  })

  it('drops credentials on a redirect to another origin, and keeps them on the same origin', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(redirect(307, '/dav/'))
      .mockResolvedValueOnce(redirect(307, 'https://cdn.example.net/file'))
      .mockResolvedValueOnce(ok())
    const { request } = proxy(send)
    await request('GET', 'https://dav.example.com/old', { Authorization: 'Basic c2VjcmV0', Cookie: 'a=b', Depth: '0' }, null)
    const headersAt = (i) => (send.mock.calls[i][1]).headers
    expect(headersAt(1)).toEqual({ Authorization: 'Basic c2VjcmV0', Cookie: 'a=b', Depth: '0' })
    expect(headersAt(2)).toEqual({ Depth: '0' })
    expect(send.mock.calls[2][0]).toBe('https://cdn.example.net/file')
  })

  it('treats a port change as another origin', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(redirect(302, 'https://dav.example.com:8443/'))
      .mockResolvedValueOnce(ok())
    const { request } = proxy(send)
    await request('GET', 'https://dav.example.com/', { authorization: 'Bearer t' }, null)
    expect((send.mock.calls[1][1]).headers).toEqual({})
  })

  it('rewrites to a bodyless GET on 303, and on 301/302 after a POST; 307 keeps method and body', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(redirect(307, '/a'))
      .mockResolvedValueOnce(redirect(303, '/b'))
      .mockResolvedValueOnce(ok())
    const { request } = proxy(send)
    await request('POST', 'https://vault.example.com/start', {}, '{"x":1}')
    const init = (i) => send.mock.calls[i][1]
    expect([init(1).method, init(1).body]).toEqual(['POST', '{"x":1}'])
    expect([init(2).method, 'body' in init(2)]).toEqual(['GET', false])
  })

  it(`gives up after ${MAX_REDIRECTS} redirects`, async () => {
    const send = vi.fn(async () => redirect(302, '/again'))
    const { request } = proxy(send)
    expect(await request('GET', 'https://loop.example.com/', {}, null)).toEqual({ error: 'Too many redirects' })
    expect(send).toHaveBeenCalledTimes(MAX_REDIRECTS + 1)
  })

  it('times out a server that never answers', async () => {
    const send = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
    const { request } = proxy(send, undefined, 20)
    expect(await request('GET', 'https://slow.example.com/', {}, null)).toEqual({ error: 'The server did not respond within 0 s' })
  })

  it('reports a network failure as an error', async () => {
    const { request } = proxy(vi.fn(async () => { throw new Error('net::ERR_CONNECTION_REFUSED') }))
    expect(await request('GET', 'https://down.example.com/', {}, null)).toEqual({ error: 'net::ERR_CONNECTION_REFUSED' })
  })
})

// GLANCEvault's media goes up and down as bytes (src/blobs/blobTransport.js).
describe('httpProxy request: bytes', () => {
  it('sends a byte body as it is', async () => {
    const send = vi.fn(async () => ok('{"ok":true}'))
    const { request } = proxy(send)
    const part = new Uint8Array([0, 255, 16, 32])
    const res = await request('PUT', 'https://vault.example.com/blobs/abc/parts/1', { 'Content-Type': 'application/octet-stream' }, part)
    expect(res.body).toBe('{"ok":true}')
    expect(send.mock.calls[0][1].body).toBe(part)
  })

  it('answers bytes when asked, exactly as the server sent them', async () => {
    const bytes = new Uint8Array([0, 159, 146, 150, 255, 254])   // not valid UTF-8: text() would mangle it
    const send = vi.fn(async () => new Response(bytes, { status: 206, headers: { 'Content-Range': 'bytes 0-5/6' } }))
    const { request } = proxy(send)
    const res = await request('GET', 'https://vault.example.com/blobs/abc', { Range: 'bytes=0-5' }, null, { binary: true })
    expect(res.status).toBe(206)
    expect(res.body).toBeInstanceOf(Uint8Array)
    expect([...res.body]).toEqual([...bytes])
    expect(res.headers['content-range']).toBe('bytes 0-5/6')
  })

  it('answers text unless bytes are asked for', async () => {
    const send = vi.fn(async () => ok('plain'))
    const { request } = proxy(send)
    for (const options of [undefined, null, {}, { binary: 'yes' }, 'binary']) {
      expect((await request('GET', 'https://example.com/', {}, null, options)).body).toBe('plain')
    }
  })

  it('refuses a body that is neither text nor bytes', async () => {
    const send = vi.fn(async () => ok())
    const { request } = proxy(send)
    for (const body of [{ a: 1 }, 42, [1, 2], new ArrayBuffer(4)]) {
      expect(await request('PUT', 'https://example.com/', {}, body)).toEqual({ error: 'Only text and byte bodies are supported' })
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('gives a media part longer than a text request before timing out', async () => {
    expect(BINARY_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS)
    const never = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const request = createHttpProxy({ send: never, validate: async () => {}, timeoutMs: 20, binaryTimeoutMs: 200 })
    const started = Date.now()
    expect(await request('GET', 'https://example.com/', {}, null)).toEqual({ error: 'The server did not respond within 0 s' })
    expect(Date.now() - started).toBeLessThan(150)
    const slow = await request('GET', 'https://example.com/', {}, null, { binary: true })
    expect(slow.error).toMatch(/did not respond/)
    expect(Date.now() - started).toBeGreaterThanOrEqual(200)
  })
})
