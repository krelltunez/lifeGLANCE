import { useCallback, useEffect, useRef, useState } from 'react'
import * as audio from '../utils/audio'
import { acquireWakeLock, releaseWakeLock } from '../utils/wakeLock'

// User input that resets the idle timer (so watch mode doesn't auto-start while
// the mouse is in use).
const ACTIVITY_EVENTS = [
  'mousemove', 'mousedown', 'pointerdown',
  'keydown', 'wheel', 'touchstart', 'touchmove', 'scroll',
]

// Deliberate interactions that EXIT watch mode once it's running. Passive
// mousemove is intentionally excluded — a drifting cursor shouldn't kick you
// out ("tap anywhere to exit").
const EXIT_EVENTS = ACTIVITY_EVENTS.filter(e => e !== 'mousemove')

// After idle starts, ignore input briefly so the initiating click/tap (and the
// natural mouse-away that follows it) doesn't immediately cancel it.
const START_GUARD_MS = 1000

/**
 * Drives "idle / watch" mode: after `timeoutMs` of no interaction (or on an
 * explicit `start()`), it walks an ordered list of events, calling `onHop` for
 * each, with the onboarding ambient playing and a screen wake lock held. Any
 * user input exits and calls `onExit`.
 *
 * @param enabled      auto-start on idle when true
 * @param timeoutMs    idle delay before auto-start
 * @param hopIntervalMs time spent on each event
 * @param events       ordered list to walk (e.g. milestones sorted ascending)
 * @param blocked      suppress auto-start (e.g. a modal is open)
 * @param onEnter      called once when idle begins (save view, switch zoom)
 * @param onHop        called per step with the current event (pan to it)
 * @param onExit       called once when idle ends (restore the saved view)
 */
export function useIdleMode({
  enabled, timeoutMs, hopIntervalMs = 5000,
  events, blocked, onEnter, onHop, onExit, dwellFor,
}) {
  const [active,       setActive]       = useState(false)
  const [currentEvent, setCurrentEvent] = useState(null)

  // Refs keep the once-registered listeners/timers reading fresh values.
  const activeRef  = useRef(false)
  const eventsRef  = useRef(events)
  const blockedRef = useRef(blocked)
  const enabledRef = useRef(enabled)
  const timeoutRef = useRef(timeoutMs)
  const cbRef      = useRef({ onEnter, onHop, onExit, dwellFor })
  eventsRef.current  = events
  blockedRef.current = blocked
  enabledRef.current = enabled
  timeoutRef.current = timeoutMs
  cbRef.current      = { onEnter, onHop, onExit, dwellFor }

  const hopTimer  = useRef(null)
  const idleTimer = useRef(null)
  const guardRef  = useRef(false)

  const stop = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    setActive(false)
    clearTimeout(hopTimer.current)
    hopTimer.current = null
    guardRef.current = false
    audio.stopAmbient()
    releaseWakeLock()
    setCurrentEvent(null)
    cbRef.current.onExit?.()
  }, [])

  const start = useCallback((viaGesture = false) => {
    if (activeRef.current) return
    const list = eventsRef.current
    if (!list || list.length === 0) return
    activeRef.current = true
    setActive(true)
    guardRef.current = true
    setTimeout(() => { guardRef.current = false }, START_GUARD_MS)

    cbRef.current.onEnter?.()
    if (viaGesture) audio.init()   // unlock AudioContext on the initiating gesture
    audio.startAmbient()
    acquireWakeLock()

    // Recursive setTimeout (not a fixed interval) so each event can dwell for a
    // different duration — see dwellFor.
    let i = 0
    const hop = () => {
      const evs = eventsRef.current
      if (!evs || evs.length === 0) { stop(); return }
      if (i >= evs.length) i = 0
      const ev = evs[i]
      setCurrentEvent(ev)
      cbRef.current.onHop?.(ev)
      i = (i + 1) % evs.length
      const dwell = cbRef.current.dwellFor?.(ev) ?? hopIntervalMs
      hopTimer.current = setTimeout(hop, dwell)
    }
    hop()
  }, [hopIntervalMs, stop])

  useEffect(() => {
    function scheduleIdle() {
      clearTimeout(idleTimer.current)
      if (!enabledRef.current) return
      idleTimer.current = setTimeout(() => {
        if (!enabledRef.current || activeRef.current || blockedRef.current) return
        if (document.visibilityState !== 'visible') return
        if (!eventsRef.current || eventsRef.current.length === 0) return
        start(false)
      }, timeoutRef.current)
    }
    function onActivity(e) {
      if (activeRef.current) {
        if (guardRef.current) return   // ignore the start gesture + mouse-away
        if (!EXIT_EVENTS.includes(e.type)) return   // passive mousemove: stay in watch mode
        stop()
      }
      scheduleIdle()
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') scheduleIdle()
      else clearTimeout(idleTimer.current)
    }
    ACTIVITY_EVENTS.forEach(ev =>
      window.addEventListener(ev, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    scheduleIdle()
    return () => {
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity))
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(idleTimer.current)
    }
  }, [start, stop])

  // Tear down on unmount.
  useEffect(() => () => stop(), [stop])

  return { active, currentEvent, start, stop }
}
