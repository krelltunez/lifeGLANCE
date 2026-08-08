// React lifecycle wrapper for the GLANCEvault SSE push client.
//
// Opens the authenticated /events stream when the vault is enabled AND the app
// is visible, turns nudges into instant drains of the EXISTING sync/intents
// drains (debounced, seq-deduped), reconnects with jittered backoff on any
// drop, reconciles via the server's `ready` frame on every (re)connect, and
// tears the connection down cleanly on background / unmount. The pure transport
// lives in ../sync/vaultEventStream; this file only wires it to React + the app.
//
// CORE INVARIANT: purely ADDITIVE. It never starts, stops, or slows the
// existing poll cadences (the 60-second sync interval in App.jsx, the intent
// poller's 2-minute cadence). Those keep running as the correctness backstop,
// so a missed nudge or an SSE-down window is always caught by the next poll.
// If SSE is unavailable (native shell without the plugin, old server,
// buffering proxy) or throws, the app degrades to exactly today's polling
// behavior.
//
// Config reactivity: unlike lastGLANCE (where a vault config change reloads the
// app, so its hook is mount-keyed), lifeGLANCE re-activates the engine IN PLACE
// (vaultSetup's runVaultSetup/disableVault → reinitDbSyncEngine). Those paths
// dispatch `lifeglance:vault-config-changed`; this hook listens and rebuilds
// the SSE client with the fresh config — same in-place contract as the engine.

import { useEffect, useRef, useState } from 'react'
import { readVaultConfig } from '../sync/dbSync.js'
import { VaultSse } from '../native/vaultSse.js'
import {
  createBridgeSseClient,
  createNudgeCoalescer,
  createVaultEventClient,
  detectSseTransport,
  openWebSseStream,
} from '../sync/vaultEventStream.js'

export function useVaultEventStream({ drainSync, drainIntents }) {
  // Keep the drain callbacks fresh without re-running the main effect (which
  // would tear down and re-open the connection on every render). Updated in an
  // effect, matching useIntentPoller's ref pattern.
  const drainSyncRef = useRef(drainSync)
  const drainIntentsRef = useRef(drainIntents)
  useEffect(() => { drainSyncRef.current = drainSync }, [drainSync])
  useEffect(() => { drainIntentsRef.current = drainIntents }, [drainIntents])

  // Bumped whenever vaultSetup re-activates/disables the vault in place, so the
  // effect below re-reads the config and rebuilds (or tears down) the client.
  const [configEpoch, setConfigEpoch] = useState(0)
  useEffect(() => {
    const bump = () => setConfigEpoch((e) => e + 1)
    window.addEventListener('lifeglance:vault-config-changed', bump)
    return () => window.removeEventListener('lifeglance:vault-config-changed', bump)
  }, [])

  useEffect(() => {
    if (!readVaultConfig()) return undefined

    const transport = detectSseTransport()
    if (transport !== 'web' && transport !== 'native-bridge') {
      // 'native-unsupported' (a shell without the VaultSse plugin) / 'none'
      // (SSR): nothing to open, nothing to clean up — polling backstop only.
      if (import.meta.env?.DEV) {
        console.info('[vault-sse] streaming unavailable on', transport, '— polling backstop only')
      }
      return undefined
    }

    // Observability: a live, inspectable snapshot so SSE health can be checked
    // in a packaged build with no devtools — run `window.__glanceVaultSse` in
    // the console (same incantation as the sibling apps, deliberately).
    // Counters make a reconnect storm (many connects, few events) immediately
    // obvious; `stalled: true` is the buffering-reverse-proxy signature (stream
    // opened, no `ready` frame arrived). Per-transition console lines are gated
    // behind the `lifeglance-debug-push` localStorage flag; genuine errors and
    // the stalled diagnostic still log unconditionally.
    const diag = {
      state: 'idle', transport, connects: 0, events: 0, drains: 0,
      lastEventSeq: null, lastError: null, stalled: false, terminal: null,
      lastConnectedAt: null,
    }
    window.__glanceVaultSse = diag

    const sseDebug = () => {
      try { return localStorage.getItem('lifeglance-debug-push') === '1' } catch { return false }
    }

    const coalescer = createNudgeCoalescer({
      onDrain: (kind) => {
        diag.drains += 1
        if (sseDebug()) console.info('[vault-sse] drain →', kind)
        if (kind === 'sync') drainSyncRef.current()
        else drainIntentsRef.current()
      },
      onDrainError: (msg, err) => console.warn('[vault-sse]', msg, err instanceof Error ? err.message : err),
    })

    const onStateChange = (state, detail) => {
      diag.state = state
      if (state === 'connecting') diag.connects += 1
      if (state === 'open') { diag.lastConnectedAt = new Date().toISOString(); diag.stalled = false }
      if (state === 'stalled') {
        // A healthy path delivers `ready` immediately; an open-but-silent
        // stream almost certainly means a buffering reverse proxy. Polling
        // masks this completely, so say it out loud once per occurrence.
        diag.stalled = true
        console.warn('[vault-sse] stream opened but no frame arrived — a reverse proxy is likely buffering /events; SSE is inert and polling is covering')
      } else if (state === 'error') {
        diag.lastError = detail instanceof Error ? detail.message
          : detail?.message ?? String(detail ?? 'error')
        // A coded error from the native reader is TERMINAL: native stopped and
        // will not reconnect ('auth' / 'insecure' / 'unsupported'). It surfaces
        // exactly once — warn loudly; a config re-save re-activates in place,
        // which starts a fresh reader. Polling covers meanwhile.
        if (detail && typeof detail === 'object' && detail.code) {
          diag.terminal = detail.code
          console.warn(`[vault-sse] terminal error (${detail.code}) — native reader stopped, not reconnecting:`, diag.lastError)
        } else {
          console.warn('[vault-sse] error:', diag.lastError)
        }
      } else if (state === 'unsupported-server') {
        console.warn('[vault-sse] this GLANCEvault server predates /events — push disabled, polling covers')
      } else if (sseDebug()) {
        console.info('[vault-sse]', state, `(connects=${diag.connects} events=${diag.events} drains=${diag.drains})`)
      }
    }

    const getConnection = () => readVaultConfig()

    const onEvent = (evt) => {
      diag.events += 1
      if (typeof evt?.seq === 'number') diag.lastEventSeq = evt.seq
      coalescer.handleEvent(evt)
    }

    // ── NATIVE-BRIDGE: the shell owns the socket + reconnect + fg/bg ─────────
    if (transport === 'native-bridge') {
      const client = createBridgeSseClient({
        getConnection,
        // JS → native: hand over the connection and say "SSE desired on". The
        // shell connects only while the app is foreground and reconnects with
        // backoff — all invisible here.
        startNative: (c) => {
          VaultSse.start({ vaultUrl: c.vaultUrl, vaultToken: c.vaultToken, accountId: c.accountId })
            .catch(err => onStateChange('error', err instanceof Error ? err.message : String(err)))
        },
        stopNative: () => { VaultSse.stop().catch(() => { /* teardown is best-effort */ }) },
        onEvent,
        onStateChange,
      })
      // Native → JS: every reader message arrives as an sseMessage plugin event.
      let handle
      VaultSse.addListener('sseMessage', client.receive).then(h => { handle = h })
      // No visibilitychange wiring here: the native shell owns
      // foreground/background and reconnect. The renderer only declares intent
      // and hands over the connection.
      client.start()

      return () => {
        client.stop()
        handle?.remove()
        coalescer.cancel()
      }
    }

    // ── WEB: JS owns the fetch stream + reconnect/backoff ────────────────────
    const client = createVaultEventClient({
      getConnection,
      openStream: openWebSseStream,
      onEvent,
      onStateChange,
    })

    // Drop SSE on background, reopen on foreground. The (re)connect delivers a
    // fresh `ready` seq that reconciles anything missed while hidden; the
    // polls cover the gap regardless.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') client.start()
      else client.stop()
    }
    document.addEventListener('visibilitychange', onVisibility)

    if (document.visibilityState !== 'hidden') client.start()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      client.stop()
      coalescer.cancel()
    }
  }, [configEpoch])
}
