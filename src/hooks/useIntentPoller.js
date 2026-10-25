import { useEffect, useRef, useCallback } from 'react'
import { pollEvents, isWebdavIntentsActive, isVaultIntentsActive, isDirectAccessIntentsActive, isICloudIntentsActive, resolveDirectAccessKey, loadIntentsConfig, flushOutbox } from '../lib/intentsTransport.js'
import { drainVaultIntents } from '../lib/intentsVaultTransport.js'
import { drainDirectAccessIntents } from '../lib/intentsDirectAccessTransport.js'
import { pollICloudIntents } from '../lib/intentsICloudTransport.js'
import { directAccessTransport } from '../sync/directAccess.js'
import { ACTIONS, SOURCE_APPS } from '@glance-apps/intents'

// Whether an inbound envelope is something lifeGLANCE actually handles:
//   - a Goal that dayGLANCE pushed to us (create),
//   - a timeline entry lastGLANCE People pushed to us (create, entity_type
//     "milestone": a contact logged with someone opted in), or
//   - a state-change notify about a task that originated here.
// The sibling apps (dayGLANCE, lastGLANCE) share the same WebDAV events
// directory, so we also see their traffic — e.g. lastGLANCE chore events.
// Those aren't actionable here and shouldn't clutter the activity log.
export const MILESTONE_ENTITY_TYPE = 'milestone'

export function isLastglanceMilestone({ action, emitted_by, payload } = {}) {
  return action === ACTIONS.CREATE && emitted_by === SOURCE_APPS.LASTGLANCE &&
    payload?.entity_type === MILESTONE_ENTITY_TYPE
}

// A `due` of YYYY-MM-DD is a local day. new Date('2026-10-14') would read it
// as UTC midnight, which is the evening before west of Greenwich.
export function localDay(due) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due ?? '')
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  const d = due ? new Date(due) : new Date()
  return Number.isNaN(d.getTime()) ? new Date() : d
}

export function isRelevantInboundEvent({ action, emitted_by, payload } = {}) {
  if (action === ACTIONS.CREATE && emitted_by === SOURCE_APPS.DAYGLANCE) return true
  if (isLastglanceMilestone({ action, emitted_by, payload })) return true
  if (action === ACTIONS.NOTIFY && payload?.source_app === SOURCE_APPS.LIFEGLANCE) return true
  return false
}

// The mounted poller's runPoll, so the vault SSE nudge path (useVaultEventStream
// → drainIntentsNow) can trigger an immediate intents drain with the SAME
// handlers and cursors the interval uses. Null while no poller is mounted —
// drainIntentsNow is then a no-op and the mount-time poll covers the gap.
let activeIntentDrain = null
export function drainIntentsNow() { activeIntentDrain?.() }

// Polls the WebDAV events directory while the component is mounted (foreground).
// Calls the appropriate handler for each inbound event:
//   onInboundCreate(payload)  — dayGLANCE pushed a new Goal → create milestone
//   onInboundNotify(payload)  — state change on a lG-originated task in dayGLANCE
//   onInboundMilestone(payload, event_id) — lastGLANCE sent a timeline entry
//   onActivityEntry(entry)    — optional; receives { type, filename, payload } for the activity log
//
// Polling runs immediately on mount, then every `intervalMin` minutes (default 2).
export function useIntentPoller({
  onInboundCreate,
  onInboundNotify,
  onInboundMilestone,
  onActivityEntry,
  intervalMin = 2,
}) {
  // Keep handler refs stable so the interval closure always sees the latest props.
  const createRef  = useRef(onInboundCreate)
  const notifyRef  = useRef(onInboundNotify)
  const milestoneRef = useRef(onInboundMilestone)
  const activityRef = useRef(onActivityEntry)
  // Last count of intents held pending the vault key, so the activity log records
  // the state only when it CHANGES (a 2-min poll cadence must not flood it).
  const lastHeldRef = useRef(0)
  useEffect(() => { createRef.current  = onInboundCreate  }, [onInboundCreate])
  useEffect(() => { notifyRef.current  = onInboundNotify  }, [onInboundNotify])
  useEffect(() => { milestoneRef.current = onInboundMilestone }, [onInboundMilestone])
  useEffect(() => { activityRef.current = onActivityEntry }, [onActivityEntry])

  // The application logic is transport-agnostic: WebDAV pollEvents and the vault
  // drain both feed the SAME router (relevance filter → create/notify handler).
  // Only the transport differs.
  const handleInbound = useCallback(async (envelope) => {
    const { action, payload, event_id, emitted_by } = envelope

    // Skip events from sibling apps that share the channel (e.g. lastGLANCE
    // chores) — not actionable here. The cursor still advances for them inside
    // the transport; we just don't surface them.
    if (!isRelevantInboundEvent(envelope)) return

    activityRef.current?.({ type: 'received', event_id, action, emitted_by, payload })

    if (action === ACTIONS.CREATE && emitted_by === SOURCE_APPS.DAYGLANCE) {
      await createRef.current?.(payload, event_id)
    } else if (isLastglanceMilestone(envelope)) {
      await milestoneRef.current?.(payload, event_id)
    } else if (action === ACTIONS.NOTIFY && payload.source_app === SOURCE_APPS.LIFEGLANCE) {
      await notifyRef.current?.(payload)
    }
  }, [])

  // The Direct Access event set (docs/direct-access.md): a local file read, so
  // it runs on the transport's own 15 s cadence below as well as on the poll.
  // A sealed envelope this device cannot open, or a sender with the encrypt
  // switch on and no key, asks for the sync passphrase through the window
  // event App.jsx turns into the passphrase modal; unlocking dispatches
  // lifeglance:intents-key-ready, which re-runs the poll.
  const lastDaHeldRef = useRef(false)
  const runDirectAccess = useCallback(async () => {
    if (!isDirectAccessIntentsActive()) return
    const { keyNeeded } = await drainDirectAccessIntents(handleInbound, {
      isEnabled: isDirectAccessIntentsActive,
      resolveKey: resolveDirectAccessKey,
      eventsPath: () => loadIntentsConfig().eventsPath,
    })
    if (keyNeeded && !lastDaHeldRef.current) {
      activityRef.current?.({ type: 'held', payload: { count: 1 } })
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('lifeglance:passphrase-required'))
    }
    lastDaHeldRef.current = keyNeeded
  }, [handleInbound])

  const runPoll = useCallback(async () => {
    const webdav = isWebdavIntentsActive()
    const vault  = isVaultIntentsActive()
    const direct = isDirectAccessIntentsActive()
    const icloud = isICloudIntentsActive()
    if (!webdav && !vault && !direct && !icloud) return

    // RECEIVE every tier (independent cursors; one being down never blocks the others).
    if (webdav) await pollEvents(handleInbound)
    if (direct) await runDirectAccess().catch(err => console.warn('[intents] direct access drain failed:', err))
    // dayGLANCE's iCloud events folder, on this poll's cadence (dayGLANCE's own).
    if (icloud) await pollICloudIntents(handleInbound).catch(err => console.warn('[intents] iCloud poll failed:', err))
    if (vault) {
      const { heldForKey = 0 } = (await drainVaultIntents(handleInbound)) ?? {}
      // Held-pending-key intents must be observable. Record the state in the
      // activity log on a CHANGE (entering a hold or the count shifting); the
      // drain's console.warn is the always-on log.
      if (heldForKey > 0 && heldForKey !== lastHeldRef.current) {
        activityRef.current?.({ type: 'held', payload: { count: heldForKey } })
      }
      lastHeldRef.current = heldForKey
    }

    // SEND: drain the durable outbox on the poll cadence (delivers anything held
    // from a previous session or while a target's key/connection was absent).
    await flushOutbox().catch(err => console.warn('[intents] outbox flush failed:', err))
  }, [handleInbound, runDirectAccess])

  // The folder tier's own cadence: the transport's poll, the foreground kick
  // and its change signal (a folder picked, re-enabled or back from away).
  // Inert while Direct Access is not the selected transport.
  useEffect(() => {
    if (!directAccessTransport.isSupported()) return
    const tick = () => {
      if (!isDirectAccessIntentsActive()) return
      runDirectAccess()
        .then(() => flushOutbox())
        .catch(err => console.warn('[intents] direct access tick failed:', err))
    }
    const id = setInterval(tick, directAccessTransport.pollMs)
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    const unsubscribe = directAccessTransport.onChanged(tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribe()
    }
  }, [runDirectAccess])

  useEffect(() => {
    runPoll() // app start / mount: receive + flush anything persisted from a previous session
    const ms = Math.max(1, intervalMin) * 60 * 1000
    const id = setInterval(runPoll, ms)
    activeIntentDrain = runPoll
    return () => {
      clearInterval(id)
      if (activeIntentDrain === runPoll) activeIntentDrain = null
    }
  }, [runPoll, intervalMin])

  // Re-drain the moment the vault intents key becomes available (dbSync dispatches
  // this after deriving it on unlock), so intents held pending the key process
  // immediately instead of waiting for the next poll tick.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onKeyReady = () => { runPoll() }
    window.addEventListener('lifeglance:intents-key-ready', onKeyReady)
    return () => window.removeEventListener('lifeglance:intents-key-ready', onKeyReady)
  }, [runPoll])
}
