// GLANCEvault's real-time push (/events, Server-Sent Events) read by the main
// process for the renderer (docs/desktop-app.md). The renderer's
// CSP allows it no request of its own, so it cannot hold the stream; the phone
// shells solve the same problem with a native reader, and this is that reader
// for the desktop. The renderer's side is unchanged: it takes the
// 'native-bridge' road of src/sync/vaultEventStream.js and receives the same
// messages the phones send:
//
//   {type:'open'}                    connected
//   {type:'frame', block}            one raw SSE event block (parsed in the renderer)
//   {type:'closed'}                  the stream dropped; the reader reconnects
//   {type:'error', message, code?}   coded errors are TERMINAL and the reader
//                                    stops: 'auth' (401/403), 'unsupported'
//                                    (404, a server without /events), 'insecure'
//                                    (cleartext http to a public host)
//
// A port of the Android reader (android/.../sse/VaultSseClient.kt, SseBackoff.kt,
// SseFraming.kt), with three desktop differences: the URL passes the same
// private-address check as every other request (a vault on the LAN needs the
// user's grant, and until then the reader retries on the 30 s cap, so it
// connects by itself once allowed); redirects are not followed but retried as
// failures; and it runs while the app runs, window shown or not.

/** Capped exponential backoff with a stability reset (SseBackoff.kt). */
export class SseBackoff {
  attempt = 0
  constructor(baseMs = 1_000, maxMs = 30_000, minStableMs = 5_000) {
    this.baseMs = baseMs
    this.maxMs = maxMs
    this.minStableMs = minStableMs
  }

  nextDelayMs() {
    const delay = Math.min(this.maxMs, this.baseMs * 2 ** Math.min(this.attempt, 30))
    this.attempt++
    return delay
  }

  /** A connection that stayed open long enough was healthy: start over at the base delay. */
  onClosed(openDurationMs) {
    if (openDurationMs >= this.minStableMs) this.attempt = 0
  }
}

/**
 * Splits stream text into complete event blocks (SseFraming.kt). Heartbeat and
 * comment-only blocks (no `data:` line) are dropped; the renderer would parse
 * them to nothing anyway. A partial block past `maxChars` throws, so a server
 * that never delimits cannot grow the buffer without bound.
 */
export class SseFraming {
  buffer = ''
  constructor(maxChars = 1_048_576) {
    this.maxChars = maxChars
  }

  append(chunk) {
    this.buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const blocks = []
    let idx
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const block = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 2)
      if (block.split('\n').some((line) => line.startsWith('data:'))) blocks.push(block)
    }
    if (this.buffer.length > this.maxChars) {
      throw new Error(`SSE frame buffer exceeded cap: ${this.buffer.length} > ${this.maxChars} chars`)
    }
    return blocks
  }
}

/**
 * https always; http only to loopback, private LAN or *.local, so the Bearer
 * token never crosses the public internet in clear (VaultSseClient.kt).
 */
export function isSecureOrLanUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'https:') return true
  if (parsed.protocol !== 'http:') return false
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host.endsWith('.local')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const octets = m.slice(1).map(Number)
  if (octets.some((o) => o > 255)) return false
  const [a, b] = octets
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

class TerminalError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const abortableSleep = (ms, signal) =>
  new Promise ((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })

export function createVaultSseReader(deps) {
  const sleep = deps.sleep ?? abortableSleep
  const now = deps.now ?? Date.now
  const connectTimeoutMs = deps.connectTimeoutMs ?? 20_000
  const readTimeoutMs = deps.readTimeoutMs ?? 60_000
  let run = null

  async function connectAndRead(connection, signal) {
    const base = connection.vaultUrl.replace(/\/+$/, '')
    const url = `${base}/events?accountId=${encodeURIComponent(connection.accountId)}`
    if (!isSecureOrLanUrl(url)) throw new TerminalError('insecure', 'vault SSE refused: insecure http URL')
    await deps.validate(url)

    // One controller per connection: stop() aborts it through `signal`, and the
    // connect and read timeouts abort it on their own.
    const connection_ = new AbortController()
    // Aborting also cancels the body reader, so a read parked on a silent
    // connection returns whatever the transport does with the signal.
    let reader = null
    const abort = () => {
      connection_.abort()
      reader?.cancel().catch(() => {})
    }
    signal.addEventListener('abort', abort, { once: true })
    let timer = setTimeout(abort, connectTimeoutMs)
    try {
      const res = await deps.fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${connection.vaultToken}`, Accept: 'text/event-stream' },
        redirect: 'manual',
        signal: connection_.signal,
      })
      if (res.status === 401 || res.status === 403) throw new TerminalError('auth', `vault SSE auth failed: ${res.status}`)
      if (res.status === 404) throw new TerminalError('unsupported', 'vault SSE unavailable: server predates /events')
      if (res.status < 200 || res.status > 299 || !res.body) throw new Error(`vault SSE connect failed: ${res.status}`)
      deps.push({ type: 'open' })

      const framing = new SseFraming()
      reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        clearTimeout(timer)
        timer = setTimeout(abort, readTimeoutMs)
        const { done, value } = await reader.read()
        if (done) break
        for (const block of framing.append(decoder.decode(value, { stream: true }))) {
          deps.push({ type: 'frame', block })
        }
      }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      connection_.abort()
    }
  }

  async function loop(connection, signal) {
    const backoff = new SseBackoff()
    while (!signal.aborted) {
      const openedAt = now()
      try {
        await connectAndRead(connection, signal)
      } catch (e) {
        if (signal.aborted) return
        if (e instanceof TerminalError) {
          deps.push({ type: 'error', code: e.code, message: e.message })
          return
        }
        deps.push({ type: 'error', message: e instanceof Error ? e.message : 'sse error' })
      }
      if (signal.aborted) return
      deps.push({ type: 'closed' })
      backoff.onClosed(now() - openedAt)
      await sleep(backoff.nextDelayMs(), signal)
    }
  }

  return {
    /** Connect (replacing any running connection) and keep reconnecting until stop(). */
    start(connection) {
      this.stop()
      const controller = new AbortController()
      run = { controller, done: loop(connection, controller.signal) }
    },
    stop() {
      run?.controller.abort()
      run = null
    },
    /** Test seam: resolves when the current run has ended. */
    settled() {
      return run?.done ?? Promise.resolve()
    },
  }
}
