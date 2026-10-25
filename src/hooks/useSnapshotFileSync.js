import { useCallback, useEffect, useRef, useState } from 'react'
import { initSessionKey } from '@glance-apps/sync'
import { runDirectAccessCycle } from '../sync/directAccessCycle.js'
import { FILE_CRYPTO_CONFIG } from '../sync/cryptoConfig.js'

// Schedules snapshot-file sync for one transport: Direct Access (a folder a
// third-party tool keeps in step, sync/directAccess.js) or iCloud (the app's
// own container, sync/icloud.js). dayGLANCE's hooks/useSnapshotFileSync.js and
// lastGLANCE's useSnapshotFileSync.ts: the poll, the foreground kick, the
// transport's change signal, the in-flight guard, the first-run question, and
// what only the UI can do with an outcome.
//
//   • onUnavailable: the transport reported an error (the syncing tool not
//     running, a grant revoked, iCloud away); it waits that out.
//   • onEncryptedUnreadable: the file is an envelope this device holds the
//     wrong key for, and the transport never writes over it. Nothing else will
//     happen until the user acts.
//   • onKeyNeeded: the file is an envelope (or this device wants to write one)
//     and no key or passphrase is in memory. The cached key is tried first,
//     once per session; only when that fails is the passphrase prompt raised.
//   • firstRun: a transport whose first-run decision is open (iCloud on a
//     fresh install) found cloud data and none of this device's own. The loop
//     stops until the user answers: restoring silently is what the question
//     exists to prevent. Picking a folder is Direct Access's decision, so it
//     never asks.
//
// The in-flight guard is SHARED across instances: two transports must never
// merge into the store at once, since each builds its payload from the store
// and applies the merge back. A cycle skipped under the guard retries once,
// two seconds later; a retry that still finds it held leaves it to the next
// poll tick (dayGLANCE: without the retry, two instances on one cadence starved
// each other on every tick).

/** How long a cycle skipped under the in-flight guard waits before its one retry. */
export const SKIPPED_RETRY_MS = 2000

// One guard for every instance (see above).
const fileTierLock = { held: false }

/**
 * @param {object} args
 * @param {object} args.transport  pollMs, isSupported, isEnabled, isAvailable (may be async), onChanged, and setEnabled where it asks the first-run question
 * @param {boolean} [args.ready] false until the sync engine (and so the payload and the apply) exists
 * @param {(error: string) => void} [args.onUnavailable]
 * @param {() => void} [args.onEncryptedUnreadable]
 * @param {() => void} [args.onKeyNeeded]
 * @param {() => Promise<boolean>} [args.restoreKey] loads the file-tier key this device cached; tried once per session before any prompt
 * @param {object} [args.cycleDeps] the cycle's other dependencies (tests)
 * @returns {{ runSync: () => Promise<string | null>, lastError: string | null, firstRun: object | null, acceptFirstRun: () => void, declineFirstRun: () => void }}
 */
export function useSnapshotFileSync({
  transport,
  ready = true,
  onUnavailable,
  onEncryptedUnreadable,
  onKeyNeeded,
  restoreKey,
  cycleDeps,
}) {
  const enabled = transport.isSupported()
  const [lastError, setLastErrorState] = useState(null)
  const [firstRun, setFirstRun] = useState(null)
  // Read back by runSync's caller right after the cycle, before a re-render.
  const lastErrorRef = useRef(null)
  // State lands a render too late to stop the next poll tick, and merging then
  // is exactly the silent restore the question exists to prevent.
  const firstRunPendingRef = useRef(false)

  // The latest callbacks and readiness, read by timers and listeners that
  // outlive the render they were armed in. Written in an effect, never during
  // render; the effects below that call runSync are declared after it and so
  // run after it.
  const callbacksRef = useRef({ onUnavailable, onEncryptedUnreadable, onKeyNeeded, restoreKey, cycleDeps })
  const readyRef = useRef(ready)

  const retryRef = useRef(null)
  // Carried between cycles: the eviction clock, the write throttle stamp and the pending relay.
  const cycleStateRef = useRef({ missingSince: 0, lastWriteAt: 0 })
  const keyRestoreTriedRef = useRef(false)

  const runCycle = async (isRetry = false) => {
    if (!enabled || !readyRef.current || firstRunPendingRef.current) return
    // Switched off on this device: fully inert, nothing read is applied and
    // nothing is written, so the file and other devices are untouched.
    if (!transport.isEnabled()) return
    if (fileTierLock.held) {
      if (!isRetry && retryRef.current === null) {
        retryRef.current = setTimeout(() => {
          retryRef.current = null
          void runCycleRef.current(true)
        }, SKIPPED_RETRY_MS)
      }
      return
    }
    fileTierLock.held = true
    const setLastError = (e) => { lastErrorRef.current = e; setLastErrorState(e) }
    const keyWanted = async () => {
      if (keyRestoreTriedRef.current) return false
      keyRestoreTriedRef.current = true
      try { return !!(await (callbacksRef.current.restoreKey ?? (() => initSessionKey(FILE_CRYPTO_CONFIG)))()) }
      catch { return false }
    }
    let rerunWithKey = false
    try {
      if (!(await transport.isAvailable())) return
      const { state, outcome } = await runDirectAccessCycle({ transport, ...callbacksRef.current.cycleDeps }, cycleStateRef.current)
      cycleStateRef.current = state
      if (outcome.kind === 'prompted') {
        firstRunPendingRef.current = true
        setFirstRun({ data: outcome.info?.data ?? {}, lastModified: outcome.info?.lastModified ?? null })
      } else if (outcome.kind === 'error') {
        console.error(`[${transport.id ?? 'file-tier'}] unavailable:`, outcome.error)
        setLastError(outcome.error)
        callbacksRef.current.onUnavailable?.(outcome.error)
      } else if (outcome.kind === 'skipped' && outcome.reason === 'encrypted-unreadable') {
        if (!outcome.needsKey) callbacksRef.current.onEncryptedUnreadable?.()
        else if (await keyWanted()) rerunWithKey = true
        else callbacksRef.current.onKeyNeeded?.()
      } else if ((outcome.kind === 'skipped' && outcome.reason === 'key-needed') || (outcome.kind === 'merged' && outcome.keyNeeded)) {
        if (await keyWanted()) rerunWithKey = true
        else callbacksRef.current.onKeyNeeded?.()
      } else if (outcome.kind === 'merged' || outcome.kind === 'seeded' || (outcome.kind === 'skipped' && outcome.reason === 'unchanged')) {
        setLastError(null)
      }
    } catch (err) {
      // A transport that throws (rather than answering an error object) must
      // not surface as an unhandled rejection from a timer; the next poll
      // retries exactly as it does for a skipped cycle.
      console.error(`[${transport.id ?? 'file-tier'}] sync cycle failed:`, err?.message ?? err)
    } finally {
      fileTierLock.held = false
    }
    if (rerunWithKey) await runCycleRef.current()
  }

  // Stable entry point: timers and listeners call through it and always reach
  // the latest closure.
  const runCycleRef = useRef(runCycle)
  useEffect(() => {
    callbacksRef.current = { onUnavailable, onEncryptedUnreadable, onKeyNeeded, restoreKey, cycleDeps }
    readyRef.current = ready
    runCycleRef.current = runCycle
  })
  const runSync = useCallback(async () => { await runCycleRef.current(); return lastErrorRef.current }, [])

  // Both answers record a decision so the question never returns.
  const acceptFirstRun = useCallback(() => {
    transport.setEnabled?.(true)
    setFirstRun(null)
    firstRunPendingRef.current = false
    void runCycleRef.current()
  }, [transport])

  const declineFirstRun = useCallback(() => {
    // Off on this device: the isEnabled gate returns early from here on, so the
    // cloud copy is never read or written from it. Reversible in Cloud Sync.
    transport.setEnabled?.(false)
    setFirstRun(null)
    firstRunPendingRef.current = false
  }, [transport])

  // Once on startup, once the engine is ready.
  useEffect(() => {
    if (!enabled || !ready) return
    void runSync()
  }, [enabled, ready, runSync])

  // Poll. The tool or the daemon handles the network; we read the local file.
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => { void runSync() }, transport.pollMs)
    return () => clearInterval(timer)
  }, [enabled, transport, runSync])

  // Re-sync when the app comes back to the foreground.
  useEffect(() => {
    if (!enabled) return
    const onVisible = () => { if (document.visibilityState === 'visible') void runSync() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [enabled, runSync])

  // The transport's push signal: a folder picked or back, a file changed
  // remotely. A cycle already running makes this a skip, and its retry picks
  // the change up.
  useEffect(() => {
    if (!enabled || !transport.onChanged) return
    const off = transport.onChanged(() => { void runSync() })
    return () => { if (typeof off === 'function') off() }
  }, [enabled, transport, runSync])

  // A retry armed just before unmount must not run against a dead instance.
  useEffect(() => {
    if (!enabled) return
    return () => {
      if (retryRef.current !== null) clearTimeout(retryRef.current)
      retryRef.current = null
    }
  }, [enabled])

  return { runSync, lastError, firstRun, acceptFirstRun, declineFirstRun }
}
