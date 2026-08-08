// GLANCEvault SSE push client — lifeGLANCE port of the family's proven core
// (lastGLANCE src/sync/vaultEventStream.ts, itself the hardened descendant of
// dayGLANCE's post-#1316 truthful-protocol client): web transport + the
// native-bridge renderer half, jitter, terminal 404 classification, and the
// stalled-stream diagnostic.
//
// WIRE CONTRACT (verified against the glance-vault server source and observed
// live): the server emits authenticated per-account named SSE events at
// GET {vaultUrl}/events?accountId= whose data is exactly {"seq":N}:
//   • `event: ready`    — once per successful connection, carrying the account's
//     latest seq (0 for a never-written account); the reconnect reconcile point.
//   • `event: activity` — whenever the account seq advances.
// plus comment-line heartbeats (`: ...`) every ~20s. Nothing else is on the
// wire: no kind/scope discriminator, no `id:`, no `retry:` (reconnect timing is
// entirely client-owned; the server never reads Last-Event-ID). A nudge carries
// ONLY the latest account seq — no payload, and no hint of WHAT advanced: sync
// writes, intent landings, and blob bookkeeping all draw from the one
// per-account counter (blob bookkeeping without even emitting), so the only
// correct response to any nudge is to drain everything, and the seq is an
// opaque watermark — never compare gap sizes against local cursors.
//
// CORE INVARIANT: push is an optimization; POLLING IS THE CORRECTNESS BACKSTOP.
// Nothing here ever stops, slows, or references the existing poll cadences (the
// 60-second sync interval in App.jsx, the intent poller's 2-minute cadence). A
// nudge only ADDS an instant drain on top; if any of this throws or the stream
// drops, polling keeps delivering. Everything is idempotent — a nudge triggers
// the SAME drains the polls trigger, and those re-read their own cursors and
// no-op when there is nothing new. The engine's self-enforced backoff
// (@glance-apps/sync 1.10.0) additionally guarantees a nudge-triggered cycle
// can never hammer a failing server.
//
// TRANSPORTS:
//   • WEB (browser/PWA): EventSource cannot set an Authorization header, and the
//     vault authenticates with a Bearer token — so we use a fetch-based
//     streaming reader (response.body.getReader()). See openWebSseStream.
//   • NATIVE-BRIDGE (Capacitor shells with the VaultSse plugin): vault HTTP
//     rides CapacitorHttp (whole-body, cannot stream), so the SHELL owns the
//     socket — a native SSE reader that connects while foreground, drops on
//     background, reconnects with backoff, and pushes each raw SSE block in as
//     a plugin event. The renderer reuses the SAME parseSseFrame + coalescer +
//     drains — only the transport INPUT differs (see createBridgeSseClient).
//     No vault CORS change: a native HTTP client has no browser origin.
//   • NATIVE-UNSUPPORTED (a shell without the plugin — an older APK/IPA until
//     the readers ship): polling only, exactly today's behavior.

import { isNativePlatform } from './nativeHttp'
import { isVaultSseNativeAvailable } from '../native/vaultSse'

// ─── SSE frame parsing ───────────────────────────────────────────────────────

/**
 * Parse ONE SSE event block (the text between blank-line boundaries) into the
 * nudge object {seq}, or null if the block carries no usable data.
 *
 * The event NAME (`ready` | `activity`) is deliberately not surfaced: both carry
 * the same instruction — the account seq advanced past what we knew — so the
 * data line is the whole contract. Ignores comment lines (leading ':', used for
 * heartbeats) and non-data fields (event:, id:, retry: — the server sends only
 * event: and data: today; tolerating the rest is plain SSE-spec hygiene).
 * Concatenates multiple data: lines per the SSE spec, then JSON-parses. Returns
 * null on a heartbeat-only block or unparseable data so the caller can skip it.
 */
export function parseSseFrame(block) {
  if (!block) return null
  const dataLines = []
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line || line.startsWith(':')) continue // blank or comment (heartbeat)
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1) // SSE strips one leading space
    if (field === 'data') dataLines.push(value)
  }
  if (dataLines.length === 0) return null
  try {
    return JSON.parse(dataLines.join('\n'))
  } catch {
    return null
  }
}

/**
 * Feed a growing SSE text buffer, emitting each COMPLETE event (delimited by a
 * blank line) via onEvent and returning the unconsumed remainder to carry into
 * the next chunk. Normalizes CRLF/CR to LF first.
 */
export function drainSseBuffer(buffer, onEvent) {
  let buf = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  let idx
  while ((idx = buf.indexOf('\n\n')) !== -1) {
    const block = buf.slice(0, idx)
    buf = buf.slice(idx + 2)
    const evt = parseSseFrame(block)
    if (evt) onEvent(evt)
  }
  return buf
}

// ─── transport detection ─────────────────────────────────────────────────────

/**
 * Which SSE consumption path this runtime supports:
 * 'web' | 'native-bridge' | 'native-unsupported' | 'none'. 'web' and
 * 'native-bridge' open a stream; every other value degrades to polling (the
 * permanent correctness backstop).
 */
export function detectSseTransport() {
  if (typeof window === 'undefined') return 'none'
  // Capacitor shell: the shell streams natively when it carries the VaultSse
  // plugin; an older shell degrades to polling (see header).
  if (isNativePlatform()) return isVaultSseNativeAvailable() ? 'native-bridge' : 'native-unsupported'
  if (typeof fetch === 'function' && typeof ReadableStream !== 'undefined') return 'web'
  return 'none'
}

// ─── web streaming reader ────────────────────────────────────────────────────

// Thrown when GET /events comes back 404: the vault predates the SSE endpoint
// (no catch-all JSON 404 exists server-side, so an unmatched route is Express's
// default). Terminal for the client — reconnecting cannot fix a server that
// lacks the route — so the connection loop stops and polling carries on alone.
// Every other status (400/401/403/429/5xx) means the route exists and the
// condition may clear, so those stay ordinary retryable connect failures.
export class SseUnsupportedError extends Error {
  constructor() {
    super('vault SSE connect failed: 404 — this GLANCEvault server predates /events')
    this.code = 'SSE_UNSUPPORTED'
  }
}

/**
 * Open the vault /events SSE stream over a fetch streaming body and pump parsed
 * {seq} nudges to onEvent until the stream ends or the signal aborts.
 * Authenticates with the same Bearer token the other vault calls use and scopes
 * to accountId (query param, mirroring the sync endpoints).
 *
 * `credentials: 'omit'` is load-bearing: the vault's CORS layer never sets
 * Access-Control-Allow-Credentials (the token rides in a header by design), so
 * an include-credentials fetch would be rejected by the browser.
 *
 * Resolves when the server closes the stream (a clean disconnect the caller
 * will reconnect from). Rejects on connect failure / network error / abort —
 * and with SseUnsupportedError on 404, which the caller treats as terminal.
 *
 * @param {object} args
 * @param {{vaultUrl: string, vaultToken: string, accountId: string}} args.connection
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.onOpen]
 * @param {Function} args.onEvent
 * @param {Function} [args.fetchImpl]
 */
export async function openWebSseStream({ connection, signal, onOpen, onEvent, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch
  const base = connection.vaultUrl.replace(/\/+$/, '')
  const url = `${base}/events?accountId=${encodeURIComponent(connection.accountId)}`
  const res = await doFetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${connection.vaultToken}`,
      Accept: 'text/event-stream',
    },
    credentials: 'omit',
    signal,
  })
  if (res && res.status === 404) throw new SseUnsupportedError()
  if (!res || !res.ok || !res.body) {
    throw new Error(`vault SSE connect failed: ${res ? res.status : 'no response'}`)
  }
  onOpen?.()

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = drainSseBuffer(buffer, onEvent)
    }
  } finally {
    try { reader.releaseLock() } catch { /* ignore */ }
  }
}

// ─── nudge coalescer (seq cursor + debounce) ─────────────────────────────────

/**
 * Turns a stream of nudge events into debounced drain calls, with a seq cursor
 * so stale/duplicate nudges are ignored.
 *
 * The account seq is a single unified monotonic counter on the server — sync
 * writes, intent landings, and blob bookkeeping all advance it — so ONE cursor
 * is correct: an event is "behind" (worth acting on) only when its seq exceeds
 * the highest we've already reacted to.
 *
 * Every accepted nudge drains BOTH sides. The wire carries no scope (data is
 * exactly {"seq":N}), and the shared counter means a scope couldn't safely
 * narrow a drain even if one existed. Rapid nudges within debounceMs coalesce
 * into a single drain pair.
 *
 * onDrain(kind) is called with 'sync' then 'intents' on each flush. The split
 * callback is kept deliberately (mirroring the sibling apps): it is the ONE
 * seam where routing would slot in if a future server ever scoped its nudges —
 * no such protocol exists or is planned today. It runs inside a try/catch so a
 * throwing drain can never break the debounce timer or the SSE loop.
 */
export function createNudgeCoalescer({
  onDrain,
  debounceMs = 400,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onDrainError,
}) {
  let lastSeq = -Infinity
  let timer = null

  const runDrain = (kind) => {
    try {
      onDrain(kind)
    } catch (err) {
      onDrainError?.(`vault-sse drain (${kind}) failed`, err)
    }
  }

  const flush = () => {
    timer = null
    // Deterministic order: sync before intents.
    runDrain('sync')
    runDrain('intents')
  }

  // Debounce ONLY — no throttle. lifeGLANCE's first-activation seeding has
  // always been behind a one-shot persisted flag (dbSync.js SEEDED_KEY), so a
  // device's own pushes can't re-mark and self-nudge into a loop; drains fire
  // near-instantly on real changes, which is the point of SSE. Polling remains
  // the backstop for any coalesced nudge.
  const schedule = () => {
    if (timer) clearTimeoutFn(timer)
    timer = setTimeoutFn(flush, debounceMs)
  }

  const handleEvent = (evt) => {
    const seq = evt?.seq
    if (typeof seq !== 'number' || Number.isNaN(seq)) return false
    if (seq <= lastSeq) return false // not behind — coalesced/stale, ignore
    lastSeq = seq
    schedule()
    return true
  }

  return {
    handleEvent,
    getCursor: () => lastSeq,
    cancel: () => { if (timer) { clearTimeoutFn(timer); timer = null } },
  }
}

// ─── connection client (reconnect + backoff) ─────────────────────────────────

/**
 * Manages the SSE connection lifecycle: connect, pump events through onEvent,
 * and on any drop reconnect with capped, JITTERED exponential backoff. It NEVER
 * touches polling — polling is a separate concern and remains the backstop for
 * every gap this client leaves (backoff waits, background, permanent failure).
 *
 * Three behaviors earned by the family's server audit (carried from lastGLANCE):
 *   • Jitter (±25%) on every reconnect delay. SSE connects count against the
 *     vault's per-IP rate limiter, and the connection-cap slot for a silently
 *     dead socket can outlive the client that held it — jitter keeps a fleet of
 *     reconnecting devices from synchronizing into bursts against either.
 *   • SseUnsupportedError (404) is TERMINAL: the loop stops for good and
 *     reports 'unsupported-server'. Reconnecting cannot grow a route the server
 *     doesn't have, and polling covers the app identically either way.
 *   • Stalled-stream diagnostic: a connection that opens but delivers no frame
 *     within readyTimeoutMs reports 'stalled' once. The server sends `ready`
 *     immediately on connect, so a silent open stream almost certainly means a
 *     buffering reverse proxy — the one SSE failure mode that is otherwise
 *     invisible, because polling masks it completely.
 *
 * Backoff resets only after a connection proves STABLE (open ≥ minStableMs) —
 * an open-then-immediate-drop endpoint would otherwise reconnect every
 * backoffBaseMs forever, a storm that also re-fires the ready reconcile drain
 * every cycle.
 *
 * States reported via onStateChange: 'connecting' | 'open' | 'closed' |
 * 'error' | 'stalled' | 'unsupported' | 'unsupported-server' | 'stopped'.
 */
export function createVaultEventClient({
  getConnection,
  openStream,
  onEvent,
  supported = true,
  backoffBaseMs = 1000,
  backoffMaxMs = 30000,
  minStableMs = 5000,
  readyTimeoutMs = 5000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  now = () => Date.now(),
  random = Math.random,
  onStateChange,
}) {
  let stopped = true
  let looping = false
  let attempt = 0
  let abortController = null
  let reconnectTimer = null
  let readyTimer = null

  const clearReadyTimer = () => {
    if (readyTimer) { clearTimeoutFn(readyTimer); readyTimer = null }
  }

  const loop = async () => {
    if (looping) return
    looping = true
    while (!stopped) {
      const connection = supported ? getConnection() : null
      if (!connection) break // nothing to connect to → let polling cover it
      abortController = typeof AbortController !== 'undefined' ? new AbortController() : null
      onStateChange?.('connecting')
      const startedAt = now()
      try {
        await openStream({
          connection,
          signal: abortController?.signal,
          // Backoff is NOT reset here — see minStableMs note in the doc block.
          onOpen: () => {
            onStateChange?.('open')
            // The server's `ready` frame arrives immediately on a healthy path;
            // an open-but-silent stream is the buffering-proxy signature.
            clearReadyTimer()
            readyTimer = setTimeoutFn(() => {
              readyTimer = null
              onStateChange?.('stalled')
            }, readyTimeoutMs)
          },
          onEvent: (evt) => {
            clearReadyTimer()
            onEvent(evt)
          },
        })
        // Stream ended cleanly (server closed / heartbeat gap) — reconnect soon.
        onStateChange?.('closed')
      } catch (err) {
        if (err?.code === 'SSE_UNSUPPORTED') {
          // Terminal: the server has no /events route. Stop for good.
          onStateChange?.('unsupported-server', err)
          stopped = true
          break
        }
        // Connect/network/abort error — SSE is additive, so we swallow it and
        // reconnect. Polling keeps delivering in the meantime.
        if (!stopped) onStateChange?.('error', err)
      } finally {
        clearReadyTimer()
      }
      if (stopped) break
      // Reset backoff ONLY for a connection that stayed open long enough to be
      // healthy; a flapping open/close keeps backing off (up to backoffMaxMs).
      if (now() - startedAt >= minStableMs) attempt = 0
      const delay = Math.min(backoffMaxMs, backoffBaseMs * 2 ** attempt) * (0.75 + random() * 0.5)
      attempt += 1
      await new Promise((resolve) => { reconnectTimer = setTimeoutFn(resolve, delay) })
      reconnectTimer = null
    }
    looping = false
  }

  return {
    start() {
      if (!supported) { onStateChange?.('unsupported'); return }
      stopped = false
      if (!looping) { attempt = 0; loop() }
    },
    stop() {
      stopped = true
      clearReadyTimer()
      if (abortController) { try { abortController.abort() } catch { /* ignore */ } abortController = null }
      if (reconnectTimer) { clearTimeoutFn(reconnectTimer); reconnectTimer = null }
      onStateChange?.('stopped')
    },
    isRunning: () => !stopped,
    isSupported: () => supported,
  }
}

// ─── bridge-fed client (native shell owns the socket) ────────────────────────

/**
 * The renderer half of the 'native-bridge' transport. Unlike
 * createVaultEventClient (which owns a fetch stream + JS-side
 * reconnect/backoff), here the NATIVE SHELL owns the socket and its whole
 * lifecycle: it connects when foreground, drops on background, and reconnects
 * with backoff — all invisible to JS. This client's job is only to (a) tell
 * native "SSE desired on/off" with the connection params, and (b) funnel the
 * raw SSE blocks native pushes back through the SAME parseSseFrame + onEvent
 * (→ coalescer → drains) the web path uses. There is deliberately NO JS
 * reconnect loop here — reconnect belongs to exactly ONE owner per transport,
 * and for native that owner is the shell. Polling remains the backstop.
 *
 * `receive` is fed by the VaultSse plugin's `sseMessage` events (see
 * src/native/vaultSse.js for the message shapes). A coded error means the
 * native reader stopped TERMINALLY and will not reconnect ('auth',
 * 'insecure', 'unsupported') — surfaced once via onStateChange with the code
 * attached so the consumer can distinguish it.
 */
export function createBridgeSseClient({
  getConnection,
  startNative,
  stopNative,
  onEvent,
  onStateChange,
}) {
  let running = false

  // The native shell pushes messages here. Accepts a parsed object OR a JSON
  // string (a shell that stringifies is handled too). Never throws — a
  // malformed push is ignored so it can't break the bridge.
  const receive = (msg) => {
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg) } catch { return }
    }
    if (!msg || typeof msg !== 'object') return
    switch (msg.type) {
      case 'open':
        onStateChange?.('open')
        break
      case 'frame': {
        // Reuse the EXISTING parser: native did transport + frame boundary
        // detection; {seq} extraction stays in ONE place (parseSseFrame).
        if (typeof msg.block === 'string') {
          const evt = parseSseFrame(msg.block)
          if (evt) onEvent(evt)
        }
        break
      }
      case 'closed':
        onStateChange?.('closed')
        break
      case 'error':
        // A coded error is terminal — native stopped and will NOT reconnect —
        // so it surfaces exactly once. Non-coded errors are informational
        // (native owns the retry).
        onStateChange?.('error', msg.code ? { message: msg.message, code: msg.code } : msg.message)
        break
      default:
        break
    }
  }

  return {
    receive,
    start() {
      if (running) return false
      const connection = getConnection()
      if (!connection) return false // nothing to connect to → polling covers it
      running = true
      onStateChange?.('connecting')
      try {
        startNative(connection)
      } catch (err) {
        onStateChange?.('error', err instanceof Error ? err.message : String(err))
      }
      return true
    },
    stop() {
      if (!running) return
      running = false
      try { stopNative() } catch { /* teardown must not throw */ }
      onStateChange?.('stopped')
    },
    isRunning: () => running,
  }
}
