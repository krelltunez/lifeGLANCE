import { describe, expect, it, vi } from 'vitest'
import { createVaultSseReader, isSecureOrLanUrl, SseBackoff, SseFraming } from './vaultSse.js'

const CONN = { vaultUrl: 'https://vault.example.com/', vaultToken: 'tok', accountId: 'acct 1' }

function stream(chunks, { hang = false } = {}) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      if (!hang) controller.close()
    },
  })
}

function harness(responses, { validate = vi.fn(async () => {}) } = {}) {
  const messages = []
  const fetch = vi.fn(async () => {
    const next = responses.shift()
    if (!next) return new Promise (() => {}) // hang: the test stops the reader
    if (next instanceof Error) throw next
    return next
  })
  const sleeps = []
  const reader = createVaultSseReader({
    fetch,
    validate,
    push: (m) => messages.push(m),
    sleep: async (ms) => { sleeps.push(ms) },
  })
  return { reader, messages, fetch, sleeps, validate }
}

const until = async (cond) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 1))
}

describe('SseBackoff', () => {
  it('doubles from 1 s to a 30 s cap, and resets after a stable connection', () => {
    const b = new SseBackoff()
    expect([1, 2, 3, 4, 5, 6, 7].map(() => b.nextDelayMs())).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
    b.onClosed(4_999)
    expect(b.nextDelayMs()).toBe(30000)
    b.onClosed(5_000)
    expect(b.nextDelayMs()).toBe(1000)
  })
})

describe('SseFraming', () => {
  it('splits blocks across chunks, normalizes CRLF and drops heartbeats', () => {
    const f = new SseFraming()
    expect(f.append(': heartbeat\n\nevent: change\r\ndata: {"seq"')).toEqual([])
    expect(f.append(':1}\r\n\r\ndata: {"seq":2}\n\n')).toEqual(['event: change\ndata: {"seq":1}', 'data: {"seq":2}'])
  })

  it('refuses to buffer a block past its cap', () => {
    expect(() => new SseFraming(10).append('data: 0123456789')).toThrow(/exceeded cap/)
  })
})

describe('isSecureOrLanUrl', () => {
  it.each(['https://vault.example.com/', 'http://127.0.0.1:8080/', 'http://192.168.1.4/', 'http://10.0.0.2/', 'http://172.20.1.1/', 'http://nas.local/', 'http://localhost:3000/', 'http://[::1]:8080/'])(
    'allows %s', (u) => { expect(isSecureOrLanUrl(u)).toBe(true) })
  it.each(['http://vault.example.com/', 'http://172.32.0.1/', 'http://8.8.8.8/', 'ftp://vault.example.com/', 'nonsense'])(
    'refuses %s', (u) => { expect(isSecureOrLanUrl(u)).toBe(false) })
})

describe('the reader', () => {
  it('connects with the token, pushes open and each frame, then closed, and reconnects', async () => {
    const { reader, messages, fetch, sleeps } = harness([
      new Response(stream([': hi\n\n', 'data: {"seq":7}\n\n'])),
    ])
    reader.start(CONN)
    await until(() => fetch.mock.calls.length >= 2)
    reader.stop()
    await reader.settled()
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://vault.example.com/events?accountId=acct%201')
    expect(init.headers).toEqual({ Authorization: 'Bearer tok', Accept: 'text/event-stream' })
    expect(init.redirect).toBe('manual')
    expect(messages.slice(0, 3)).toEqual([{ type: 'open' }, { type: 'frame', block: 'data: {"seq":7}' }, { type: 'closed' }])
    expect(sleeps[0]).toBe(1000)
  })

  it.each([
    [401, 'auth'], [403, 'auth'], [404, 'unsupported'],
  ])('stops for good on %i (%s)', async (status, code) => {
    const { reader, messages, fetch } = harness([new Response('', { status })])
    reader.start(CONN)
    await reader.settled()
    expect(messages).toEqual([{ type: 'error', code, message: expect.any(String) }])
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('refuses cleartext http to a public host without connecting', async () => {
    const { reader, messages, fetch } = harness([])
    reader.start({ ...CONN, vaultUrl: 'http://vault.example.com' })
    await reader.settled()
    expect(messages).toEqual([{ type: 'error', code: 'insecure', message: expect.any(String) }])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retries, with backoff, a server error, a redirect, a network failure and an ungranted private address', async () => {
    let refuse = true
    const validate = vi.fn(async () => { if (refuse) { refuse = false; throw new Error('Private/reserved address') } })
    const { reader, messages, sleeps, fetch } = harness([
      new Response('', { status: 503 }),
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.com/' } }),
      new Error('net::ERR_CONNECTION_RESET'),
    ], { validate })
    reader.start(CONN)
    await until(() => fetch.mock.calls.length >= 4)
    reader.stop()
    await reader.settled()
    const errors = messages.filter((m) => m.type === 'error').map((m) => m.message)
    expect(errors).toEqual([
      'Private/reserved address',
      'vault SSE connect failed: 503',
      'vault SSE connect failed: 302',
      'net::ERR_CONNECTION_RESET',
    ])
    expect(messages.every((m) => !m.code)).toBe(true)
    expect(sleeps.slice(0, 4)).toEqual([1000, 2000, 4000, 8000])
  })

  it('drops a connection that goes silent past the read timeout', async () => {
    const messages = []
    let calls = 0
    const reader = createVaultSseReader({
      fetch: async () => {
        calls++
        return new Response(stream(['data: {"seq":1}\n\n'], { hang: true }))
      },
      validate: async () => {},
      push: (m) => messages.push(m),
      sleep: async () => {},
      readTimeoutMs: 20,
    })
    reader.start(CONN)
    await until(() => calls >= 2)
    reader.stop()
    await reader.settled()
    expect(messages.slice(0, 3).map((m) => m.type)).toEqual(['open', 'frame', 'closed'])
  })

  it('stops without pushing anything further', async () => {
    const { reader, messages } = harness([new Response(stream(['data: {"seq":1}\n\n'], { hang: true }))])
    reader.start(CONN)
    await until(() => messages.length >= 2)
    reader.stop()
    await reader.settled()
    expect(messages.map((m) => m.type)).toEqual(['open', 'frame'])
  })
})
