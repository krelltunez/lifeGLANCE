import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Timeline          from './Timeline'
import StatsPanel        from '../stats/StatsPanel'
import AddMilestoneSheet from '../milestone/AddMilestoneSheet'
import MilestoneDetail   from '../milestone/MilestoneDetail'
import SettingsModal     from '../settings/SettingsModal'
import HelpModal                from '../help/HelpModal'
import KeyboardShortcutsModal  from '../help/KeyboardShortcutsModal'
import SearchModal       from '../search/SearchModal'
import SummaryModal      from '../stats/SummaryModal'
import OnThisDayModal    from './OnThisDayModal'
import IcsImportModal    from '../import/IcsImportModal'
import MinimapBar        from '../minimap/MinimapBar'
import TypewriterText    from '../ui/TypewriterText'
import { ZOOM_LEVELS, applyRecurFilter } from '../../utils/timeline'
import { expandAnnualDates } from '../../utils/recurrence'
import { loadCategories } from '../../utils/colors'
import { getMilestoneVisibility, precomputeEndpoints } from '../../utils/visibility'
import { addMilestone, updateMilestone, deleteMilestone, restoreMilestones, uid } from '../../data/milestones'
import { listChapters, restoreChapters, createChapter, updateChapter, deleteChapter } from '../../data/chapters'
import { writeMilestoneTombstone } from '../../sync/tombstones'
import { getSyncEngine } from '../../sync/engine'
import ChapterSheet from '../chapter/ChapterSheet'
import CloudSyncModal from '../sync/CloudSyncModal'
import SyncPassphraseModal from '../sync/SyncPassphraseModal'
import AutoBackupModal from '../sync/AutoBackupModal'
import { dbPutMedia, dbPutPhoto, dbDeletePhoto, dbGetPhoto, dbPut } from '../../data/db'
import { parseIcs }      from '../../utils/icsParser'
import * as audio from '../../utils/audio'
import { useIntentPoller } from '../../hooks/useIntentPoller.js'
import { emitCreateForMilestone, emitRescheduledNotify, emitStateNotify, isIntegrationEnabled } from '../../lib/intentsTransport.js'
import { appendActivityEntry } from '../../lib/intentsActivityLog.js'
import ActivityLogModal from '../dayglance/ActivityLogModal.jsx'
import { EVENTS } from '@glance-apps/intents'

const ZOOM_RANK = { decades: 5, '30yr': 4, years: 3, months: 2, weeks: 1, custom: 3.5 }

const TEXT_SIZES = {
  small:  '19px',
  normal: '22px',
  big:    '26px',
  bigger: '30px',
}

const ZOOM_ANIM_MS = 420

export default function TimelineView({ milestones, setMilestones, chapters, setChapters, syncStatus, syncError, syncHalted, lastSynced, onOpenCloudSync }) {
  const { t } = useTranslation('timeline')
  const { t: tdg } = useTranslation('dayglance')
  const { t: tc } = useTranslation('common')

  // Computed display labels (stable within a render, i18next t is referentially stable)
  const ZOOM_LABELS = {
    decades: t('zoomLabelDecades'),
    '30yr':  t('zoomLabel30yr'),
    years:   t('zoomLabelYears'),
    months:  t('zoomLabelMonths'),
    weeks:   t('zoomLabelWeeks'),
    custom:  t('zoomLabelCustom'),
  }
  const RECUR_LABELS = {
    next:   t('recurLabelNext'),
    all:    t('recurLabelAll'),
    past:   t('recurLabelPast'),
    future: t('recurLabelFuture'),
  }

  const [zoom,          setZoom]          = useState('years')
  const [zoomAnim,      setZoomAnim]      = useState('')
  const [filter,        setFilter]        = useState(new Set())
  const [addOpen,       setAddOpen]       = useState(false)
  const [editTarget,    setEditTarget]    = useState(null)
  const [detail,        setDetail]        = useState(null)
  const [textSize,      setTextSize]      = useState(() => {
    const stored = localStorage.getItem('lifeglance-text-size')
    if (stored) return stored
    // First-visit default: estimate available SVG height (total minus fixed chrome)
    const hEst = window.innerHeight - 141
    if (hEst < 240) return 'small'
    if (hEst < 640) return 'normal'
    return 'big'
  })
  const [customYears,   setCustomYears]   = useState(15)
  const [pastIdx,       setPastIdx]       = useState(0)
  const [futureIdx,     setFutureIdx]     = useState(0)
  const [selectedId,    setSelectedId]    = useState(null)
  const [highlightsActive, setHighlightsActive] = useState(true)
  const [settingsOpen,  setSettingsOpen]  = useState(false)
  const [helpOpen,      setHelpOpen]      = useState(false)
  const [kbdOpen,       setKbdOpen]       = useState(false)
  const [searchOpen,    setSearchOpen]    = useState(false)
  const [viewMode,      setViewMode]      = useState('all')
  const [recurFilter,   setRecurFilter]   = useState('next')
  const [categories,    setCategories]    = useState(loadCategories)
  const [panMs,         setPanMs]         = useState(0)
  const [compactHeader, setCompactHeader] = useState(
    () => window.matchMedia('(max-width: 1080px)').matches
  )
  const [zoomOpen,      setZoomOpen]      = useState(false)
  const [compactFilter, setCompactFilter] = useState(
    () => window.matchMedia('(max-width: 1200px)').matches
  )
  const [filterOpen,    setFilterOpen]    = useState(false)
  const [compactStats,  setCompactStats]  = useState(
    () => window.matchMedia('(max-width: 768px), (max-height: 600px)').matches
  )
  const [ultraCompact,  setUltraCompact]  = useState(
    () => window.matchMedia('(max-height: 500px)').matches
  )
  const [clustering,    setClustering]    = useState(
    () => localStorage.getItem('lifeglance-clustering') !== 'false'
  )
  const [birthday,      setBirthday]      = useState(
    () => localStorage.getItem('lifeglance-birthday') || ''
  )
  const [canUndo,       setCanUndo]       = useState(false)
  const [canRedo,       setCanRedo]       = useState(false)
  const [chapterSheetOpen, setChapterSheetOpen] = useState(false)
  const [editChapter,      setEditChapter]      = useState(null)
  const [drilledChapter,   setDrilledChapter]   = useState(null)
  const predrillRef        = useRef(null) // { zoom, customYears, panMs } — ref avoids stale-closure issues
  const [newlyAddedId,     setNewlyAddedId]     = useState(null)
  const [summaryOpen,      setSummaryOpen]      = useState(false)
  const [onThisDayOpen,    setOnThisDayOpen]    = useState(false)
  const [activityLogOpen,  setActivityLogOpen]  = useState(false)
  const [icsImport,     setIcsImport]     = useState(null)  // { candidates, timedCount } | null
  const [toast,         setToast]         = useState(null)  // { message, type } | null
  const [mediaConfirm,  setMediaConfirm]  = useState(null)  // { data, existing, fileSize, remaining } | null
  const [cloudSyncOpen,   setCloudSyncOpen]   = useState(false)
  const [autoBackupOpen,  setAutoBackupOpen]  = useState(false)

  const timelineRef    = useRef(null)
  const zoomWrapRef    = useRef(null)
  const bodyRef        = useRef(null)
  const zoomRef        = useRef('years')
  const zoomLocked     = useRef(false)
  const customInputRef = useRef(null)
  const historyRef     = useRef(null)   // { stack: Milestone[][], idx: number }
  const toastTimerRef  = useRef(null)

  // Apply font size globally
  useEffect(() => {
    document.documentElement.style.fontSize = TEXT_SIZES[textSize]
    localStorage.setItem('lifeglance-text-size', textSize)
  }, [textSize])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1080px)')
    const handler = (e) => setCompactHeader(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (!zoomOpen) return
    const close = () => setZoomOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [zoomOpen])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1200px)')
    const handler = (e) => setCompactFilter(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (!filterOpen) return
    const close = () => setFilterOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [filterOpen])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px), (max-height: 600px)')
    const handler = (e) => setCompactStats(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-height: 500px)')
    const handler = (e) => setUltraCompact(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // ── dayGLANCE intents integration (Phase 5) ───────────────────────────────────

  // Stable ref so poller callbacks always see current milestones without re-registering.
  const milestonesRef = useRef(milestones)
  useEffect(() => { milestonesRef.current = milestones }, [milestones])

  // Inbound: dayGLANCE pushed a new Goal → create a mirrored milestone here.
  const handleInboundCreate = useCallback(async (payload, event_id) => {
    if (!payload.title) return
    try {
      if (event_id && milestonesRef.current.some(m => m.id === event_id)) return
      const m = await addMilestone({
        id:               event_id,
        title:            payload.title,
        date:             payload.due ? new Date(payload.due) : new Date(),
        date_precision:   'day',
        note:             payload.notes ?? '',
        dayglance_linked: true,
        // source_entity_id is the dayGLANCE task id for this goal
        dayglance_task_id: payload.source_entity_id ?? null,
      })
      setMilestones(prev => {
        const next = [...prev, m]
        pushHistory(next)
        return next
      })
      showToast(tdg('toastGoalAdded', { title: m.title }), 'success')
    } catch (err) {
      console.error('[intents] inbound create failed:', err)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Inbound: dayGLANCE notifying of a state change on one of our milestones.
  const handleInboundNotify = useCallback(async (payload) => {
    const { event, source_entity_id, due, previous_due, completed_at, title } = payload
    const current = milestonesRef.current.find(m => m.id === source_entity_id)
    if (!current) return

    try {
      if (event === EVENTS.COMPLETED) {
        const updated = await updateMilestone(current.id, {
          dayglance_completed:    true,
          dayglance_completed_at: completed_at ?? new Date().toISOString(),
        }, current)
        setMilestones(prev => prev.map(m => m.id === current.id ? updated : m))
        showToast(tdg('toastGoalCompleted', { title: current.title }), 'success')

      } else if (event === EVENTS.RESCHEDULED && due) {
        const updated = await updateMilestone(current.id, { date: new Date(due) }, current)
        setMilestones(prev => prev.map(m => m.id === current.id ? updated : m))

      } else if (event === EVENTS.UPDATED && title && title !== current.title) {
        const updated = await updateMilestone(current.id, { title }, current)
        setMilestones(prev => prev.map(m => m.id === current.id ? updated : m))

      } else if (event === EVENTS.DELETED) {
        showToast(tdg('toastGoalDeleted', { title: current.title }), 'info')

      } else if (event === EVENTS.UNCOMPLETED) {
        const updated = await updateMilestone(current.id, {
          dayglance_completed:    false,
          dayglance_completed_at: null,
        }, current)
        setMilestones(prev => prev.map(m => m.id === current.id ? updated : m))
      }
    } catch (err) {
      console.error('[intents] inbound notify handler failed:', err)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const intentsConfig = isIntegrationEnabled()
    ? JSON.parse(localStorage.getItem('lifeglance-intents-config') || '{}')
    : null

  useIntentPoller({
    onInboundCreate:  handleInboundCreate,
    onInboundNotify:  handleInboundNotify,
    onActivityEntry:  appendActivityEntry,
    intervalMin:      intentsConfig?.pollIntervalMin ?? 2,
  })

  // Restrict text size: big/bigger cards overflow the axis on short screens.
  useEffect(() => {
    if (ultraCompact && (textSize === 'big' || textSize === 'bigger')) {
      setTextSize('normal')
    }
  }, [ultraCompact, textSize])

  // ── Zoom ─────────────────────────────────────────────────────────────────────
  const handleZoom = useCallback((newZoom) => {
    if (newZoom === zoom) return
    const dir = ZOOM_RANK[newZoom] > ZOOM_RANK[zoom] ? 'zooming-out' : 'zooming-in'
    setZoomAnim(dir)
    setTimeout(() => { setZoom(newZoom); setZoomAnim('') }, ZOOM_ANIM_MS)
  }, [zoom])

  useEffect(() => { zoomRef.current = zoom }, [zoom])
  const handleZoomRef = useRef(handleZoom)
  useEffect(() => { handleZoomRef.current = handleZoom }, [handleZoom])

  // Wheel zoom (non-passive so we can preventDefault)
  useEffect(() => {
    const el = zoomWrapRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      if (zoomLocked.current) return
      const idx     = ZOOM_LEVELS.indexOf(zoomRef.current)
      const nextIdx = e.deltaY < 0 ? idx + 1 : idx - 1
      if (nextIdx < 0 || nextIdx >= ZOOM_LEVELS.length) return
      zoomLocked.current = true
      setTimeout(() => { zoomLocked.current = false }, ZOOM_ANIM_MS + 60)
      handleZoomRef.current(ZOOM_LEVELS[nextIdx])
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Visibility precomputation ─────────────────────────────────────────────────
  // Precompute endpoint data once per chapters change. This is O(chapters × members)
  // and avoids re-scanning chapters for every milestone on every render.
  const visibilityPrecomputed = React.useMemo(() => precomputeEndpoints(chapters), [chapters])

  // ── Filter ───────────────────────────────────────────────────────────────────
  const presentCategories = categories.filter(cat =>
    milestones.some(m => m.category === cat.id)
  )
  const hasRecurring = milestones.some(m => m.recurrence_id)
  const categoryFiltered = filter.size === 0 ? milestones : milestones.filter(m => filter.has(m.category))

  function toggleCategoryFilter(catId) {
    setFilter(prev => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      if (presentCategories.every(c => next.has(c.id))) return new Set()
      return next
    })
  }
  const recurFiltered = applyRecurFilter(categoryFiltered, recurFilter)
  // Apply cascade visibility — hidden milestones are excluded entirely from the
  // main timeline render (no layout space, not in the DOM, not hoverable).
  const filteredMilestones = recurFiltered.filter(m =>
    getMilestoneVisibility(m, chapters, visibilityPrecomputed, 'main').visible
  )

  function cycleRecurFilter() {
    setRecurFilter(f => ({ next: 'all', all: 'past', past: 'future', future: 'next' }[f]))
  }

  // ── "On this day" — milestones that share today's month (and day if precision allows) ──
  const onThisDayItems = React.useMemo(() => {
    const today = new Date()
    const todayMonth = today.getMonth() + 1
    const todayDay   = today.getDate()
    return milestones.filter(m => {
      if (new Date(m.date) >= today) return false
      if (m.date_precision === 'year') return false
      const d = new Date(m.date)
      const sameMonth = d.getMonth() + 1 === todayMonth
      if (m.date_precision === 'month') return sameMonth
      return sameMonth && d.getDate() === todayDay
    }).sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [milestones])

  // ── Past / future for stat panel ─────────────────────────────────────────────
  const now    = new Date()
  const past   = [...filteredMilestones]
    .filter(m => new Date(m.date) < now)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
  const future = [...filteredMilestones]
    .filter(m => new Date(m.date) >= now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  // Clamp indices when lists shrink
  useEffect(() => {
    setPastIdx(i => Math.min(i, Math.max(0, past.length - 1)))
  }, [past.length])
  useEffect(() => {
    setFutureIdx(i => Math.min(i, Math.max(0, future.length - 1)))
  }, [future.length])

  const highlightedIds = highlightsActive
    ? new Set([past[pastIdx]?.id, future[futureIdx]?.id].filter(Boolean))
    : new Set()

  // ── Stat panel navigation (shared by buttons, keyboard, and swipe) ───────────
  function handlePastNav(i) {
    const clamped = Math.max(0, Math.min(i, past.length - 1))
    setPastIdx(clamped)
    setSelectedId(null)
    setHighlightsActive(true)
    const m = past[clamped]
    if (m) timelineRef.current?.panToMs(new Date(m.date).getTime())
  }

  function handleFutureNav(i) {
    const clamped = Math.max(0, Math.min(i, future.length - 1))
    setFutureIdx(clamped)
    setSelectedId(null)
    setHighlightsActive(true)
    const m = future[clamped]
    if (m) timelineRef.current?.panToMs(new Date(m.date).getTime())
  }

  // ── Milestone click: first click selects + centers, second opens detail ───────
  function handleMilestoneClick(m) {
    if (highlightsActive && selectedId === m.id) {
      setDetail(m)
    } else {
      setSelectedId(m.id)
      setHighlightsActive(true)
      timelineRef.current?.panToMs(new Date(m.date).getTime())
      const pastI = past.findIndex(p => p.id === m.id)
      if (pastI !== -1) {
        setPastIdx(pastI)
      } else {
        const futureI = future.findIndex(f => f.id === m.id)
        if (futureI !== -1) setFutureIdx(futureI)
      }
    }
  }

  // ── Jump to today ─────────────────────────────────────────────────────────────
  function handleJumpToToday() {
    timelineRef.current?.resetPan()
    setPastIdx(0)
    setFutureIdx(0)
    setSelectedId(null)
    setHighlightsActive(true)
  }

  // ── Cluster click: zoom in one level and pan to cluster centre ───────────────
  function handleClusterClick(clusterCenterMs) {
    timelineRef.current?.panToMs(clusterCenterMs)
    const idx = ZOOM_LEVELS.indexOf(zoom)
    if (idx < ZOOM_LEVELS.length - 1) handleZoom(ZOOM_LEVELS[idx + 1])
  }

  // ── Search select ────────────────────────────────────────────────────────────
  function handleSearchSelect(m) {
    setSearchOpen(false)
    setSelectedId(m.id)
    setHighlightsActive(true)
    timelineRef.current?.panToMs(new Date(m.date).getTime())
    const pastI = past.findIndex(p => p.id === m.id)
    if (pastI !== -1) {
      setPastIdx(pastI)
    } else {
      const futureI = future.findIndex(f => f.id === m.id)
      if (futureI !== -1) setFutureIdx(futureI)
    }
  }

  // ── View mode ────────────────────────────────────────────────────────────────
  function handleViewMode(mode) {
    setViewMode(mode)
    setPanMs(0)
    if (timelineRef.current) timelineRef.current.resetPan()
  }

  // ── Undo / redo ───────────────────────────────────────────────────────────────
  // Snapshot-based: each mutation stores the full milestones array.
  // historyRef.current = { stack: Milestone[][], idx: number }
  // stack[idx] is the current state; stack[idx-1] is "one undo ago".

  function pushHistory(newMs) {
    if (!historyRef.current) {
      // lazy init: capture the pre-mutation state as the base entry
      historyRef.current = { stack: [milestones], idx: 0 }
    }
    const h = historyRef.current
    h.stack = h.stack.slice(0, h.idx + 1)   // discard any redo history
    h.stack.push(newMs)
    if (h.stack.length > 51) h.stack.shift() // cap memory at 50 undos
    else h.idx++
    setCanUndo(h.idx > 0)
    setCanRedo(false)
  }

  async function handleUndo() {
    const h = historyRef.current
    if (!h || h.idx === 0) return
    h.idx--
    const snapshot = h.stack[h.idx]
    await restoreMilestones(snapshot)
    setMilestones(snapshot)
    setCanUndo(h.idx > 0)
    setCanRedo(true)
  }

  async function handleRedo() {
    const h = historyRef.current
    if (!h || h.idx >= h.stack.length - 1) return
    h.idx++
    const snapshot = h.stack[h.idx]
    await restoreMilestones(snapshot)
    setMilestones(snapshot)
    setCanUndo(true)
    setCanRedo(h.idx < h.stack.length - 1)
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  // Use a ref so the listener is registered once but always sees fresh state
  const keyStateRef = useRef(null)
  keyStateRef.current = {
    pastIdx, futureIdx, past, future, zoom,
    addOpen, detail, settingsOpen, helpOpen, kbdOpen, searchOpen, chapterSheetOpen, drilledChapter, activityLogOpen,
    handlePastNav, handleFutureNav, handleJumpToToday, handleViewMode, closeSheet,
    handleUndo, handleRedo, canUndo, canRedo,
    clustering, setClustering,
    exitDrillIn, openChapterCreate,
  }

  useEffect(() => {
    function onKey(e) {
      // Allow Escape through even when an input is focused (to close modals)
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && e.key !== 'Escape') return
      // Blur focused buttons so keyboard shortcuts work after clicking UI elements.
      // Exception: Space on a button should still activate it (handled per-case below).
      if (e.target.tagName === 'BUTTON' && e.key !== ' ' && e.key !== 'Enter') {
        e.target.blur()
      }
      audio.init()   // unlock AudioContext on first keystroke (idempotent)
      const s = keyStateRef.current
      const anyModal = s.addOpen || !!s.detail || s.settingsOpen || s.helpOpen || s.kbdOpen || s.searchOpen || s.chapterSheetOpen
      const anyDrillIn = !!s.drilledChapter

      switch (e.key) {
        case 'ArrowLeft': {
          if (anyModal) break
          e.preventDefault()
          if (s.past.length > 0) {
            audio.playNavTick(false)
            s.handlePastNav((s.pastIdx + 1) % s.past.length)
          }
          break
        }
        case 'ArrowRight': {
          if (anyModal) break
          e.preventDefault()
          if (s.future.length > 0) {
            audio.playNavTick(true)
            s.handleFutureNav((s.futureIdx + 1) % s.future.length)
          }
          break
        }
        case 'ArrowUp': {
          if (anyModal) break
          e.preventDefault()
          const upIdx = ZOOM_LEVELS.indexOf(s.zoom)
          if (upIdx < ZOOM_LEVELS.length - 1) handleZoomRef.current(ZOOM_LEVELS[upIdx + 1])
          break
        }
        case 'ArrowDown': {
          if (anyModal) break
          e.preventDefault()
          const downIdx = ZOOM_LEVELS.indexOf(s.zoom)
          if (downIdx > 0) handleZoomRef.current(ZOOM_LEVELS[downIdx - 1])
          break
        }
        case 't': case 'T': {
          if (anyModal) break
          s.handleJumpToToday()
          break
        }
        case 'e': case 'E': {
          if (anyModal) break
          handleExportImage()
          break
        }
        case 'n': {
          if (s.settingsOpen || !!s.detail) break
          if (!s.addOpen) { e.preventDefault(); setAddOpen(true) }
          break
        }
        case 'N': {
          if (anyModal) break
          e.preventDefault()
          s.openChapterCreate()
          break
        }
        case 's': case 'S': {
          if (s.addOpen || !!s.detail || s.helpOpen) break
          if (!s.settingsOpen) setSettingsOpen(true)
          break
        }
        case 'c': case 'C': {
          if (anyModal) break
          if (s.zoom === 'custom') {
            customInputRef.current?.focus()
          } else {
            handleZoomRef.current('custom')
            // autoFocus fires when the input mounts
          }
          break
        }
        case 'p': case 'P': {
          if (anyModal) break
          s.handleViewMode('past')
          break
        }
        case 'a': case 'A': {
          if (anyModal) break
          s.handleViewMode('all')
          break
        }
        case 'f': case 'F': {
          if (anyModal) break
          s.handleViewMode('future')
          break
        }
        case 'l':
        case 'L':
          if (s.addOpen || !!s.detail || s.settingsOpen || s.helpOpen || s.searchOpen) break
          if (isIntegrationEnabled()) setActivityLogOpen(v => !v)
          break
        case '/': {
          e.preventDefault() // prevent browser Quick Find (Firefox etc.) regardless
          if (s.addOpen || !!s.detail || s.settingsOpen || s.helpOpen) break
          if (!s.searchOpen) setSearchOpen(true)
          break
        }
        case '?': {
          if (s.addOpen || !!s.detail || s.settingsOpen || s.helpOpen || s.searchOpen) break
          if (!s.kbdOpen) setKbdOpen(true)
          break
        }
        case '1': case '2': case '3': case '4': case '5':
        case '6': case '7': case '8': case '9': {
          if (anyModal) break
          e.preventDefault()
          const num = parseInt(e.key, 10)
          setCustomYears(num)
          if (s.zoom === 'custom') {
            customInputRef.current?.focus()
          } else {
            handleZoomRef.current('custom')
            // autoFocus fires when the input mounts after the zoom animation
          }
          break
        }
        case ' ': {
          if (anyModal) break
          if (e.target.tagName === 'BUTTON') break  // let Space activate focused buttons normally
          e.preventDefault()
          const next = !s.clustering
          s.setClustering(next)
          localStorage.setItem('lifeglance-clustering', String(next))
          break
        }
        case 'm': case 'M': {
          if (anyModal) break
          audio.toggleMuted()
          break
        }
        case 'z': case 'Z': {
          if (anyModal) break
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            if (e.shiftKey) { if (s.canRedo) s.handleRedo() }
            else            { if (s.canUndo) s.handleUndo() }
          }
          break
        }
        case 'y': case 'Y': {
          if (anyModal) break
          if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
            e.preventDefault()
            if (s.canRedo) s.handleRedo()
          }
          break
        }
        case 'Escape': {
          if (customInputRef.current && document.activeElement === customInputRef.current) {
            customInputRef.current.blur()
            if (!anyDrillIn) break
            // If drilled in, fall through and exit drill-in after blurring the input.
          }
          if (s.detail)                { setDetail(null); break }
          if (s.addOpen)               { s.closeSheet(); break }
          if (s.chapterSheetOpen)      { setChapterSheetOpen(false); setEditChapter(null); break }
          if (s.settingsOpen)          { setSettingsOpen(false); break }
          if (s.helpOpen)              { setHelpOpen(false); break }
          if (s.kbdOpen)               { setKbdOpen(false); break }
          if (s.searchOpen)            { setSearchOpen(false); break }
          if (s.activityLogOpen)        { setActivityLogOpen(false); break }
          if (anyDrillIn)              { s.exitDrillIn(); break }
          break
        }
        default: break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // stable — reads fresh values from keyStateRef

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function fmtBytes(n) {
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
    return `${(n / 1024 ** 3).toFixed(1)} GB`
  }

  // ── Toast ────────────────────────────────────────────────────────────────────
  function showToast(message, type = 'error') {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ message, type })
    toastTimerRef.current = setTimeout(() => setToast(null), 5000)
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  async function executeSave(data, existing) {
    // photoFile / photoRemoved / mediaFile / mediaRemoved are transfer-only fields
    // from the form — strip them before passing to the data layer and handle blob
    // persistence here.
    const { mediaFile, mediaRemoved, photoFile, photoRemoved, chapterIds, closeChapterIds,
            trackAsDayglanceGoal, ...milestoneData } = data
    const newMediaType = mediaFile
      ? (mediaFile.type.startsWith('video/') ? 'video' : 'audio')
      : null

    try {
      if (existing) {
        const mediaType = mediaFile    ? newMediaType
                        : mediaRemoved ? null
                        : (existing.media_type ?? null)
        const hasPhoto  = photoFile    ? true
                        : photoRemoved ? false
                        : (existing.has_photo ?? false)
        const updated = await updateMilestone(existing.id, { ...milestoneData, media_type: mediaType, has_photo: hasPhoto }, existing)
        if (mediaFile)    await dbPutMedia(updated.id, mediaFile, mediaFile.type)
        if (photoFile)    await dbPutPhoto(updated.id, photoFile, photoFile.type)
        if (photoRemoved) await dbDeletePhoto(updated.id)
        const newMs = milestones.map(m => m.id === existing.id ? updated : m)
        pushHistory(newMs)
        setMilestones(newMs)
        audio.playEditSave()
        // Emit create if the user just enabled dayGLANCE tracking for the first time.
        if (updated.dayglance_linked && !existing.dayglance_linked) {
          emitCreateForMilestone(updated).then(() =>
            appendActivityEntry({ type: 'sent', action: 'create', payload: { title: updated.title } })
          ).catch(err => console.warn('[intents] create emit failed:', err))
        }
        // Emit rescheduled notify if this milestone is linked and the date changed.
        if (updated.dayglance_linked && existing.dayglance_linked && existing.date !== updated.date) {
          emitRescheduledNotify(updated, existing.date).catch(err =>
            console.warn('[intents] rescheduled emit failed:', err)
          )
        }
        // Emit updated notify if the title changed.
        if (updated.dayglance_linked && existing.dayglance_linked && existing.title !== updated.title) {
          emitStateNotify(updated, EVENTS.UPDATED).catch(err =>
            console.warn('[intents] updated emit failed:', err)
          )
        }
      } else if (milestoneData.recurrence === 'annual') {
        // Generate one instance per year from base year to chosen end year (max +99)
        const rid      = uid()
        const baseDate = new Date(milestoneData.date)
        const baseYear = baseDate.getFullYear()
        const reqEnd   = milestoneData.recurrenceEndYear ?? Math.max(baseYear, new Date().getFullYear()) + 3
        const dates    = expandAnnualDates(baseDate, reqEnd)
        const created  = []
        for (const d of dates) {
          const isBase = d.getFullYear() === baseYear
          const m = await addMilestone({
            ...milestoneData,
            date:          d,
            recurrence_id: rid,
            // only the base-year instance keeps the original note / photo / media / url
            note:       isBase ? milestoneData.note      : '',
            photo_uri:  '',
            has_photo:  isBase ? milestoneData.has_photo : false,
            media_type: isBase ? newMediaType            : null,
            url:        isBase ? milestoneData.url       : '',
          })
          if (isBase && mediaFile) await dbPutMedia(m.id, mediaFile, mediaFile.type)
          if (isBase && milestoneData.photoFile) await dbPutPhoto(m.id, milestoneData.photoFile, milestoneData.photoFile.type)
          created.push(m)
        }
        const newMs = [...milestones, ...created]
        pushHistory(newMs)
        setMilestones(newMs)
        setNewlyAddedId(created[0].id)
        audio.playChime()
      } else {
        const dgLinked = !!trackAsDayglanceGoal
        const m = await addMilestone({
          ...milestoneData,
          media_type:       newMediaType,
          has_photo:        !!photoFile,
          dayglance_linked: dgLinked,
        })
        if (mediaFile) await dbPutMedia(m.id, mediaFile, mediaFile.type)
        if (photoFile) await dbPutPhoto(m.id, photoFile, photoFile.type)
        const newMs = [...milestones, m]
        pushHistory(newMs)
        setMilestones(newMs)
        setNewlyAddedId(m.id)
        // Emit outbound create to dayGLANCE if the user checked "track as dayGLANCE Goal".
        if (dgLinked) {
          emitCreateForMilestone(m).then(() =>
            appendActivityEntry({ type: 'sent', action: 'create', payload: { title: m.title } })
          ).catch(err => console.warn('[intents] create emit failed:', err))
        }
        // Add to any chapters the user selected in the form, and close ongoing chapters if requested.
        if (chapterIds?.length || closeChapterIds?.length) {
          const updated = [...chapters]
          for (const chId of (chapterIds ?? [])) {
            const idx = updated.findIndex(c => c.id === chId)
            if (idx === -1 || updated[idx].milestoneIds.includes(m.id)) continue
            updated[idx] = await updateChapter(
              chId,
              { milestoneIds: [...updated[idx].milestoneIds, m.id] },
              updated[idx],
            )
          }
          for (const chId of (closeChapterIds ?? [])) {
            const idx = updated.findIndex(c => c.id === chId)
            if (idx === -1 || updated[idx].end !== null) continue
            updated[idx] = await updateChapter(
              chId,
              { end: m.date },
              updated[idx],
            )
          }
          setChapters(updated)
          // Sync drilledChapter if it was modified (new member or closed).
          if (drilledChapter) {
            const refreshed = updated.find(c => c.id === drilledChapter.id)
            if (refreshed) setDrilledChapter(refreshed)
          }
        }
        audio.playChime()
      }
    } catch (err) {
      console.error('Save failed:', err)
      const isQuota = err?.name === 'QuotaExceededError' || err?.code === 22
      showToast(isQuota
        ? 'Storage full — export a backup to free space, then try again.'
        : 'Failed to save milestone. Please try again.'
      )
    }
  }

  async function handleSave(data, existing) {
    audio.init()   // ensure AudioContext is running (form submit = user gesture)
    const { mediaFile, photoFile } = data
    const bigFile = mediaFile || (photoFile && photoFile.size > 50 * 1024 * 1024 ? photoFile : null)

    if (bigFile) {
      let remaining = null
      if (navigator.storage?.estimate) {
        try {
          const { quota, usage } = await navigator.storage.estimate()
          remaining = quota - usage
          if (remaining < bigFile.size) {
            showToast('Not enough storage space for this file. Free up space and try again.')
            return
          }
        } catch { /* estimate unavailable, proceed */ }
      }
      if (bigFile.size > 50 * 1024 * 1024) {
        setMediaConfirm({ data, existing, fileSize: bigFile.size, remaining })
        return
      }
    }

    await executeSave(data, existing)
  }

  async function handleDelete(id) {
    try {
      const target = milestones.find(m => m.id === id)
      await deleteMilestone(id)
      const newMs = milestones.filter(m => m.id !== id)
      pushHistory(newMs)
      setMilestones(newMs)
      getSyncEngine()?.upload()
      if (target?.dayglance_linked) {
        emitStateNotify(target, EVENTS.DELETED).catch(err =>
          console.warn('[intents] deleted emit failed:', err)
        )
      }
    } catch (err) {
      console.error('Delete failed:', err)
      showToast('Failed to delete milestone. Please try again.')
    }
  }

  async function handleDeleteSeries(recurrence_id) {
    try {
      const toDelete = milestones.filter(m => m.recurrence_id === recurrence_id)
      for (const m of toDelete) {
        writeMilestoneTombstone(m.id)
        await deleteMilestone(m.id)
      }
      const newMs = milestones.filter(m => m.recurrence_id !== recurrence_id)
      pushHistory(newMs)
      setMilestones(newMs)
      getSyncEngine()?.upload()
    } catch (err) {
      console.error('Delete series failed:', err)
      showToast('Failed to delete recurring series. Please try again.')
    }
  }

  function openEdit(m)  { setEditTarget(m); setAddOpen(true) }
  function closeSheet() { setAddOpen(false); setEditTarget(null) }

  // ── Chapter CRUD ─────────────────────────────────────────────────────────────
  function openChapterCreate() { setEditChapter(null); setChapterSheetOpen(true) }
  function openChapterEdit(ch) { setEditChapter(ch);   setChapterSheetOpen(true) }
  function closeChapterSheet() { setChapterSheetOpen(false); setEditChapter(null) }

  async function handleChapterSave(data, existing) {
    const startIso = new Date(data.start).toISOString()
    const endIso   = data.end ? new Date(data.end).toISOString() : null

    if (existing) {
      const updated = await updateChapter(
        existing.id,
        {
          title:                  data.title,
          start:                  startIso,
          end:                    endIso,
          color:                  data.color,
          description:            data.description,
          defaultMemberVisibility: data.defaultMemberVisibility,
          milestoneIds:           data.milestoneIds,
        },
        existing,
      )
      setChapters(prev => prev.map(c => c.id === existing.id ? updated : c))
      // Keep drilledChapter in sync so the drill view reflects edits immediately.
      if (drilledChapter?.id === existing.id) setDrilledChapter(updated)
    } else {
      const chapter = await createChapter({
        title:                  data.title,
        start:                  data.start,
        end:                    data.end,   // null for ongoing
        color:                  data.color,
        description:            data.description,
        defaultMemberVisibility: data.defaultMemberVisibility,
      })
      // Set member milestones if any were selected
      const final = data.milestoneIds.length > 0
        ? await updateChapter(chapter.id, { milestoneIds: data.milestoneIds }, chapter)
        : chapter
      setChapters(prev => [...prev, final])
    }
  }

  async function handleChapterDelete(id) {
    try {
      await deleteChapter(id)
    } catch (err) {
      console.error('Failed to delete chapter:', err)
      showToast('Failed to delete chapter. Please try again.')
      return
    }
    setChapters(prev => prev.filter(c => c.id !== id))
    if (drilledChapter?.id === id) exitDrillIn(true)
    getSyncEngine()?.upload()
  }

  // ── Drill-in (Phase 5) ───────────────────────────────────────────────────────
  function handleChapterClick(chapter) {
    audio.init()  // chapter clicks may be the first gesture after page load
    // Clicking the ribbon while drilled in acts as a toggle — drill back out.
    if (drilledChapter) { exitDrillIn(); return }

    // Save current view state in a ref so exitDrillIn always reads the latest value
    // regardless of which render's closure calls it.
    predrillRef.current = { zoom, customYears, panMs }

    // Set drilledChapter immediately (before the animation) so that keyStateRef
    // reflects the drilled state right away — this means ESC works during the
    // enter animation rather than requiring a second press after it completes.
    setDrilledChapter(chapter)
    audio.playDrillIn()

    // Compute zoom-to-fit: center on the chapter with 15% padding each side.
    // For ongoing chapters use today as the effective end.
    const startMs         = new Date(chapter.start).getTime()
    const endMs           = chapter.end ? new Date(chapter.end).getTime() : Date.now()
    const chapterCenterMs = (startMs + endMs) / 2
    const halfMs          = (endMs - startMs) / 2 * 1.15
    const halfYears       = halfMs / (365.25 * 24 * 3600 * 1000)

    setZoomAnim('zooming-in')
    setTimeout(() => {
      setZoom('custom')
      setCustomYears(Math.max(0.1, halfYears))
      setPanMs(chapterCenterMs - Date.now())
      setZoomAnim('')
    }, ZOOM_ANIM_MS)
  }

  function exitDrillIn(immediate = false) {
    const restore = () => {
      const saved = predrillRef.current
      if (saved) {
        setZoom(saved.zoom)
        setCustomYears(saved.customYears)
        setPanMs(saved.panMs)
        predrillRef.current = null
      }
      setDrilledChapter(null)
      setZoomAnim('')
    }
    if (immediate) { restore(); return }
    audio.playDrillOut()
    setZoomAnim('zooming-out')
    setTimeout(restore, ZOOM_ANIM_MS)
  }

  // ── Export image ─────────────────────────────────────────────────────────────
  async function handleExportImage() {
    const svgEl = zoomWrapRef.current?.querySelector('svg')
    if (!svgEl) return
    try {
      const { width: w, height: h } = svgEl.getBoundingClientRect()
      const scale = 2
      // The today marker's drop-shadow glow bleeds above y=0. Shift the viewBox
      // up by topInset so that region is captured instead of clipped.
      const topInset = 20

      // Clone SVG, fix rem font-size (canvas defaults 1rem→16px, not the app's value),
      // expand height + viewBox to capture above-axis glow, and inject a dark bg rect.
      const clone = svgEl.cloneNode(true)
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      clone.setAttribute('width', w)
      clone.setAttribute('height', h + topInset)
      clone.setAttribute('viewBox', `0 ${-topInset} ${w} ${h + topInset}`)
      clone.style.fontSize = getComputedStyle(svgEl).fontSize // e.g. "22px"

      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      bg.setAttribute('x', '0')
      bg.setAttribute('y', String(-topInset))
      bg.setAttribute('width', String(w))
      bg.setAttribute('height', String(h + topInset))
      bg.setAttribute('fill', '#0F1117')
      clone.insertBefore(bg, clone.firstChild)

      // Embed Courier Prime — fetch the Google Fonts CSS, then each woff2 file,
      // encode as base64, and inject a <style> block so the sandboxed SVG img
      // renders the correct font.
      try {
        const fontLink = document.querySelector('link[href*="googleapis.com"][href*="Courier"]')
        if (fontLink) {
          const css = await (await fetch(fontLink.href)).text()
          const blocks = css.match(/@font-face\s*\{[^}]+\}/g) ?? []
          const embedded = await Promise.all(blocks.map(async block => {
            const m = block.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/)
            if (!m) return block
            try {
              const buf = await (await fetch(m[1])).arrayBuffer()
              const b64 = btoa([...new Uint8Array(buf)].map(b => String.fromCharCode(b)).join(''))
              return block.replace(m[0], `url('data:font/woff2;base64,${b64}')`)
            } catch { return null }
          }))
          const valid = embedded.filter(Boolean)
          if (valid.length) {
            const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
            style.textContent = valid.join('\n')
            clone.insertBefore(style, clone.firstChild)
          }
        }
      } catch { /* fall back to system monospace */ }

      const svgStr = new XMLSerializer().serializeToString(clone)
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
      const svgUrl  = URL.createObjectURL(svgBlob)

      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(w * scale)
      canvas.height = Math.round((h + topInset) * scale)
      const ctx = canvas.getContext('2d')
      ctx.scale(scale, scale)

      await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => { ctx.drawImage(img, 0, 0); URL.revokeObjectURL(svgUrl); resolve() }
        img.onerror = reject
        img.src = svgUrl
      })

      // Draw lifeGLANCE branding watermark in bottom-left corner
      const brandPad = 20
      const brandY   = h + topInset - 24
      ctx.save()
      ctx.textBaseline = 'alphabetic'
      ctx.font = `400 70px 'Courier Prime', 'Courier New', monospace`
      const lifeW = ctx.measureText('life').width
      ctx.fillStyle = '#E8E0D0'
      ctx.fillText('life', brandPad, brandY)
      ctx.font = `bold italic 75px 'Courier Prime', 'Courier New', monospace`
      ctx.fillStyle = '#3D3580'
      ctx.fillText('GLANCE', brandPad + lifeW, brandY)
      ctx.restore()

      canvas.toBlob(blob => {
        const d = new Date()
        const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
        const a = document.createElement('a')
        a.download = `lifeglance-${stamp}.png`
        a.href = URL.createObjectURL(blob)
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(a.href), 100)
      }, 'image/png')
    } catch (err) {
      console.error('Export failed:', err)
    }
  }

  // ── Backup ───────────────────────────────────────────────────────────────────
  async function handleSaveBackup() {
    // Collect photos as base64 data-URIs keyed by milestone id
    const photos = {}
    for (const m of milestones) {
      if (!m.has_photo) continue
      try {
        const result = await dbGetPhoto(m.id)
        if (!result) continue
        const buf = await result.blob.arrayBuffer()
        const b64 = btoa([...new Uint8Array(buf)].map(b => String.fromCharCode(b)).join(''))
        photos[m.id] = `data:${result.mimeType};base64,${b64}`
      } catch { /* skip unreadable photo */ }
    }

    const chapters = await listChapters()
    const payload = { milestones, photos, chapters }
    const json = JSON.stringify(payload, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    const d    = new Date()
    const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    a.download = `lifeglance-${stamp}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportIcsFile(file) {
    try {
      const text = await file.text()
      const result = parseIcs(text)
      setIcsImport(result)
    } catch (err) {
      console.error('ICS parse failed:', err)
    }
  }

  async function handleIcsImport(selected) {
    const added = []
    let failed = 0
    for (const row of selected) {
      try {
        const m = await addMilestone({
          title:          row.title,
          date:           row.date,
          date_precision: 'day',
          category:       row.category,
          note:           row.note,
          url:            row.url,
        })
        added.push(m)
      } catch (err) {
        console.error('ICS import item failed:', err)
        failed++
      }
    }
    const newMs = [...milestones, ...added]
    pushHistory(newMs)
    setMilestones(newMs)
    setIcsImport(null)
    if (failed > 0) {
      showToast(`${failed} event${failed > 1 ? 's' : ''} failed to import. ${added.length} imported successfully.`)
    }
  }

  async function handleRestoreFile(e) {
    const file = e.target.files[0]
    if (!file) return
    try {
      const text   = await file.text()
      const parsed = JSON.parse(text)

      // Support legacy milestone-only format (plain array) and current format
      // ({ milestones, photos, chapters }).  Backups with an 'eras' key instead of
      // 'chapters' are from a pre-rename dev build and are not supported.
      if (!Array.isArray(parsed) && Array.isArray(parsed.eras) && !Array.isArray(parsed.chapters)) {
        throw new Error('This backup was created before the Chapters rename and cannot be imported. Please regenerate the backup from the app.')
      }

      const items    = Array.isArray(parsed) ? parsed : (parsed.milestones ?? parsed)
      const photos   = (!Array.isArray(parsed) && parsed.photos) ? parsed.photos : {}
      const chapters = (!Array.isArray(parsed) && Array.isArray(parsed.chapters)) ? parsed.chapters : []

      const restored = await restoreMilestones(items)
      await restoreChapters(chapters)

      // Re-import photo blobs into the media store
      for (const m of restored) {
        const dataUri = photos[m.id]
        if (!dataUri) continue
        try {
          const [header, b64] = dataUri.split(',')
          const mimeType = header.match(/:(.*?);/)[1]
          const raw      = atob(b64)
          const arr      = new Uint8Array(raw.length)
          for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
          const blob = new Blob([arr], { type: mimeType })
          await dbPutPhoto(m.id, blob, mimeType)
          // Mark the milestone as having a photo now that the blob is stored
          m.has_photo = true
        } catch { /* malformed data-URI — skip */ }
      }

      // Persist any has_photo=true updates
      for (const m of restored) {
        if (m.has_photo) await dbPut(m)
      }

      setMilestones([...restored])
      setChapters([...chapters])
      historyRef.current = { stack: [[...restored]], idx: 0 }
      setCanUndo(false)
      setCanRedo(false)
    } catch (err) {
      console.error('Restore failed:', err)
      showToast(err.message || 'Restore failed. The backup file may be invalid.')
    }
    e.target.value = ''
  }

  // In drill-in mode: show only the drilled chapter's member milestones (hidden entirely,
  // not dimmed) and only the drilled chapter's ribbon. The stat-panel highlights still
  // apply among whichever members happen to be the next/prev highlighted milestone.
  const isEmpty = filteredMilestones.length === 0 && milestones.length === 0
  const customHalfMs  = customYears * 365.25 * 24 * 3600 * 1000
  const drillMilestones = drilledChapter
    ? milestones.filter(m => drilledChapter.milestoneIds.includes(m.id))
    : filteredMilestones
  const drillChapters   = drilledChapter ? [drilledChapter] : chapters
  const drillHighlighted = highlightedIds

  function fmtChapterDate(iso) {
    return new Date(iso).toLocaleString('default', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  }

  return (
    <div className="timeline-view">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="timeline-header"
        style={drilledChapter ? { borderBottom: `1px solid ${drilledChapter.color}44` } : undefined}
      >
        {/* Left: logo / breadcrumb */}
        {drilledChapter ? (
          <div className="drill-breadcrumb" style={{ '--drill-color': drilledChapter.color }}>
            <div className="drill-breadcrumb-nav">
              <button className="drill-breadcrumb-life" onClick={() => exitDrillIn()}>
                <span className="logo-life">life</span><span className="logo-glance">GLANCE</span>
              </button>
              <span className="drill-breadcrumb-sep">›</span>
              <TypewriterText
                key={drilledChapter.id}
                text={drilledChapter.title}
                options={{ delay: 42, jitter: 16 }}
                showCursor={false}
                hideCursorWhenDone
                className="drill-breadcrumb-chapter"
              />
              <button className="drill-breadcrumb-close" onClick={() => exitDrillIn()} title="exit chapter view">✕</button>
            </div>
            <div className="drill-breadcrumb-meta">
              <span>{fmtChapterDate(drilledChapter.start)} – {drilledChapter.end ? fmtChapterDate(drilledChapter.end) : t('ongoing')}</span>
              <span className="drill-breadcrumb-dot">·</span>
              <span>{t('memberCount', { count: drilledChapter.milestoneIds.length })}</span>
              {drilledChapter.description && <>
                <span className="drill-breadcrumb-dot">·</span>
                <span className="drill-breadcrumb-desc">{drilledChapter.description}</span>
              </>}
            </div>
          </div>
        ) : (
          <div className="logo logo-sm">
            <span className="logo-life">life</span>
            <span className="logo-glance">GLANCE</span>
          </div>
        )}

        {/* Center: zoom row + view picker */}
        <div className="header-center">
          {compactHeader ? (
            /* Single row on narrow screens: zoom ▾  |  past ↺  |  rec: next */
            <div className="compact-controls-row">
              <div className="zoom-dropdown-wrap" onClick={e => e.stopPropagation()}>
                <button
                  className="zoom-tab active zoom-dropdown-btn"
                  onClick={() => setZoomOpen(o => !o)}>
                  {ZOOM_LABELS[zoom] ?? zoom} ▾
                </button>
                {zoomOpen && (
                  <div className="zoom-dropdown">
                    {[...ZOOM_LEVELS, 'custom'].map(z => (
                      <button key={z}
                        className={`zoom-dropdown-item ${zoom === z ? 'active' : ''}`}
                        onClick={() => { handleZoom(z); setZoomOpen(false) }}>
                        {ZOOM_LABELS[z] ?? z}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {zoom === 'custom' && (
                <div className="custom-zoom-row">
                  <span>±</span>
                  <input ref={customInputRef} autoFocus={!drilledChapter}
                    className="custom-zoom-input" type="number" min="1" max="200"
                    value={customYears}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10)
                      if (!isNaN(v)) setCustomYears(Math.max(1, Math.min(200, v)))
                    }} />
                  <span>{t('zoomYrUnit')}</span>
                </div>
              )}
              <button
                className="zoom-tab active view-cycle-btn"
                onClick={() => handleViewMode(
                  viewMode === 'past' ? 'all' : viewMode === 'all' ? 'future' : 'past'
                )}>
                {RECUR_LABELS[viewMode] ?? viewMode} ↺
              </button>
              {hasRecurring && (
                <button
                  className={`recur-filter-btn${recurFilter !== 'next' ? ' active' : ''}`}
                  onClick={cycleRecurFilter}>
                  {t('recurCompact', { filter: RECUR_LABELS[recurFilter] ?? recurFilter })}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="zoom-row">
                <div className="zoom-tabs">
                  {ZOOM_LEVELS.map(z => (
                    <button key={z}
                      className={`zoom-tab ${zoom === z ? 'active' : ''}`}
                      onClick={() => handleZoom(z)}>{ZOOM_LABELS[z] ?? z}</button>
                  ))}
                  <button
                    className={`zoom-tab ${zoom === 'custom' ? 'active' : ''}`}
                    onClick={() => handleZoom('custom')}>{t('zoomLabelCustom')}</button>
                </div>
                <div className="zoom-indicator">
                  {zoom === 'custom' ? (
                    <div className="custom-zoom-row">
                      <span>±</span>
                      <input ref={customInputRef} autoFocus={!drilledChapter}
                        className="custom-zoom-input" type="number" min="1" max="200"
                        value={customYears}
                        onChange={e => {
                          const v = parseInt(e.target.value, 10)
                          if (!isNaN(v)) setCustomYears(Math.max(1, Math.min(200, v)))
                        }} />
                      <span>{t('zoomYrUnit')}</span>
                    </div>
                  ) : (
                    <TypewriterText key={zoom} text={t('viewing', { zoom: ZOOM_LABELS[zoom] ?? zoom })}
                      options={{ delay: 38, jitter: 18 }} showCursor={false} hideCursorWhenDone />
                  )}
                </div>
              </div>
              <div className="view-tabs-row">
                <div className="view-tabs">
                  {[['past', t('viewPast')], ['all', t('viewAll')], ['future', t('viewFuture')]].map(([mode, label]) => (
                    <button key={mode}
                      className={`view-tab ${viewMode === mode ? 'active' : ''}`}
                      onClick={() => handleViewMode(mode)}>{label}</button>
                  ))}
                </div>
                {hasRecurring && (
                  <button
                    className={`recur-filter-btn${recurFilter !== 'next' ? ' active' : ''}`}
                    onClick={cycleRecurFilter}>
                    {t('recurFull', { filter: RECUR_LABELS[recurFilter] ?? recurFilter })}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right: stats + settings + help + sync indicator */}
        <div className="header-right">
          <button className="action-link" onClick={() => setSummaryOpen(true)}>{t('statsBtn')}</button>
          <span className="action-sep">|</span>
          <button className="action-link" onClick={() => setSettingsOpen(true)}>{t('settingsBtn')}</button>
          <span className="action-sep">|</span>
          <button className="action-link" onClick={() => setHelpOpen(true)}>?</button>
          {onOpenCloudSync && (
            <>
              <span className="action-sep">|</span>
              <button
                className="action-link sync-status-btn"
                onClick={onOpenCloudSync}
                title={syncHalted ? t('syncErrorTitle') : syncStatus === 'syncing' ? t('syncingTitle') : syncError ? t('syncErrorSimple') : t('cloudSyncTitle')}
              >
                <span
                  className="sync-dot"
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    marginRight: '4px',
                    background: syncHalted || syncError ? '#E85D75' : syncStatus === 'syncing' ? '#D4A800' : '#34D399',
                  }}
                />
                {t('syncBtn')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="timeline-body" ref={bodyRef}>
        {!isEmpty && (
          <StatsPanel
            past={past} future={future}
            pastIdx={pastIdx} futureIdx={futureIdx}
            onPastChange={handlePastNav}
            onFutureChange={handleFutureNav}
            viewMode={viewMode}
            compact={compactStats}
          />
        )}

        <div
          ref={zoomWrapRef}
          className={`timeline-zoom-wrap ${zoomAnim}`}
          style={drilledChapter ? { '--drill-color': drilledChapter.color } : undefined}
        >
          <Timeline
            ref={timelineRef}
            milestones={drillMilestones}
            chapters={drillChapters}
            zoom={zoom}
            textSize={textSize}
            customHalfMs={customHalfMs}
            highlightedIds={drillHighlighted}
            onMilestoneClick={handleMilestoneClick}
            onChapterClick={handleChapterClick}
            onChapterDoubleClick={openChapterEdit}
            panMs={panMs}
            onPanMs={setPanMs}
            viewMode={viewMode}
            onClusterClick={handleClusterClick}
            clustering={clustering}
            birthday={birthday}
            newlyAddedId={newlyAddedId}
            ultraCompact={ultraCompact}
          />
        </div>

        {isEmpty && (
          <div className="empty-state">
            <div className="empty-state-label">
              {t('emptyState').split('\n').map((line, i) => (
                <React.Fragment key={i}>{line}{i === 0 && <br />}</React.Fragment>
              ))}
            </div>
          </div>
        )}
        {!isEmpty && filteredMilestones.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-label">{t('emptyFiltered', { count: filter.size })}</div>
          </div>
        )}
      </div>

      {/* ── Minimap ────────────────────────────────────────────────────────── */}
      {!isEmpty && (
        <MinimapBar
          milestones={filteredMilestones}
          chapters={chapters}
          panMs={panMs}
          onPanDirect={setPanMs}
          panToMs={(ms) => timelineRef.current?.panToMs(ms)}
          zoom={zoom}
          customHalfMs={customHalfMs}
          viewMode={viewMode}
        />
      )}

      {/* ── Bottom bar ─────────────────────────────────────────────────────── */}
      <div className="timeline-bottom">
        <button className="add-milestone-btn" onClick={() => setAddOpen(true)}>
          {ultraCompact ? t('addMilestoneShort') : t('addMilestone')}
        </button>
        <button className="add-milestone-btn add-chapter-btn" onClick={openChapterCreate}>
          {ultraCompact ? t('addChapterShort') : t('addChapter')}
        </button>

        {presentCategories.length > 0 && (
          compactFilter ? (
            <div className="filter-compact" onClick={e => e.stopPropagation()}>
              <button className={`filter-chip ${filter.size === 0 ? 'active' : ''}`}
                onClick={() => { setFilter(new Set()); setFilterOpen(false) }}>{t('filterAll')}</button>
              <div className="filter-dropdown-wrap">
                <button
                  className={`filter-chip filter-dropdown-btn ${filter.size > 0 ? 'active' : ''}`}
                  onClick={() => setFilterOpen(o => !o)}>
                  {filter.size === 1 ? (
                    <>
                      <span className="filter-dot"
                        style={{ background: presentCategories.find(c => filter.has(c.id))?.color }} />
                      {presentCategories.find(c => filter.has(c.id))?.label}
                    </>
                  ) : filter.size > 1 ? t('filterCategories', { count: filter.size }) : t('filterCategory')} ▾
                </button>
                {filterOpen && (
                  <div className="filter-dropdown">
                    {presentCategories.map(cat => (
                      <button key={cat.id}
                        className={`filter-dropdown-item ${filter.has(cat.id) ? 'active' : ''}`}
                        onClick={() => toggleCategoryFilter(cat.id)}>
                        <span className="filter-dot" style={{ background: cat.color }} />
                        {cat.label}
                        {filter.has(cat.id) && <span className="filter-check">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="filter-chips-inline">
              <button className={`filter-chip ${filter.size === 0 ? 'active' : ''}`}
                onClick={() => setFilter(new Set())}>{t('filterAll')}</button>
              {presentCategories.map(cat => (
                <button key={cat.id}
                  className={`filter-chip ${filter.has(cat.id) ? 'active' : ''}`}
                  onClick={() => toggleCategoryFilter(cat.id)}>
                  <span className="filter-dot" style={{ background: cat.color }} />
                  {cat.label}
                </button>
              ))}
            </div>
          )
        )}

        {onThisDayItems.length > 0 && (
          <button className="today-btn otd-btn" onClick={() => setOnThisDayOpen(true)}>
            {t('onThisDay')}
          </button>
        )}
        <button className="today-btn" onClick={handleJumpToToday}>
          {t('jumpToToday')}
        </button>
      </div>

      {/* ── Sheets ─────────────────────────────────────────────────────────── */}
      {addOpen && (
        <AddMilestoneSheet
          onSave={handleSave} onClose={closeSheet} existing={editTarget}
          categories={categories}
          chapters={chapters}
          visibilityPrecomputed={visibilityPrecomputed}
          drilledChapter={drilledChapter}
        />
      )}
      {chapterSheetOpen && (
        <ChapterSheet
          onSave={handleChapterSave}
          onClose={closeChapterSheet}
          onDelete={handleChapterDelete}
          existing={editChapter}
          milestones={milestones}
        />
      )}
      {detail && (
        <MilestoneDetail
          milestone={detail}
          onClose={() => setDetail(null)}
          onEdit={openEdit}
          onDelete={handleDelete}
          onDeleteSeries={handleDeleteSeries}
          birthday={birthday}
          categories={categories}
        />
      )}
      {searchOpen && (
        <SearchModal
          milestones={milestones}
          chapters={chapters}
          onSelect={handleSearchSelect}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {helpOpen && (
        <HelpModal
          onClose={() => setHelpOpen(false)}
          onOpenShortcuts={() => setKbdOpen(true)}
        />
      )}
      {kbdOpen && (
        <KeyboardShortcutsModal onClose={() => setKbdOpen(false)} />
      )}
      {summaryOpen && (
        <SummaryModal
          milestones={milestones}
          onClose={() => setSummaryOpen(false)}
        />
      )}
      {onThisDayOpen && (
        <OnThisDayModal
          items={onThisDayItems}
          onClose={() => setOnThisDayOpen(false)}
          onSelect={m => { setOnThisDayOpen(false); setDetail(m) }}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          textSize={textSize}       onTextSizeChange={setTextSize}
          ultraCompact={ultraCompact}
          categories={categories}   onCategoriesChange={setCategories}
          clustering={clustering}   onClusteringChange={v => {
            setClustering(v)
            localStorage.setItem('lifeglance-clustering', String(v))
          }}
          birthday={birthday}       onBirthdayChange={v => {
            setBirthday(v)
            localStorage.setItem('lifeglance-birthday', v)
            localStorage.setItem('lifeglance-birthday-updated-at', new Date().toISOString())
          }}
          milestones={milestones}
          onExportImage={handleExportImage}
          onSaveBackup={handleSaveBackup}
          onRestoreFile={handleRestoreFile}
          onImportIcsFile={handleImportIcsFile}
          onOpenCloudSync={onOpenCloudSync ? () => { setSettingsOpen(false); onOpenCloudSync() } : undefined}
          onOpenAutoBackup={() => { setSettingsOpen(false); setAutoBackupOpen(true) }}
          onOpenActivityLog={isIntegrationEnabled() ? () => { setSettingsOpen(false); setActivityLogOpen(true) } : undefined}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {activityLogOpen && (
        <ActivityLogModal onClose={() => setActivityLogOpen(false)} />
      )}
      {icsImport && (
        <IcsImportModal
          candidates={icsImport.candidates}
          timedCount={icsImport.timedCount}
          categories={categories}
          onImport={handleIcsImport}
          onClose={() => setIcsImport(null)}
        />
      )}
      {mediaConfirm && (
        <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && setMediaConfirm(null)}>
          <div className="media-confirm-modal">
            <p className="media-confirm-title">{t('mediaLargeFile')}</p>
            <p className="media-confirm-body">
              {t('mediaFileSize', { size: fmtBytes(mediaConfirm.fileSize) })}
              {mediaConfirm.remaining != null && (
                <> {t('mediaStorageRemaining', { size: fmtBytes(mediaConfirm.remaining) })}</>
              )}
            </p>
            <div className="media-confirm-actions">
              <button className="btn" onClick={() => setMediaConfirm(null)}>{tc('cancel')}</button>
              <button className="btn btn-filled" onClick={async () => {
                const { data, existing } = mediaConfirm
                setMediaConfirm(null)
                await executeSave(data, existing)
              }}>{t('mediaAttachAnyway')}</button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className={`toast toast-${toast.type}`} role="alert" onClick={() => setToast(null)}>
          {toast.message}
        </div>
      )}
      {cloudSyncOpen && (
        <CloudSyncModal
          syncStatus={syncStatus}
          syncError={syncError}
          syncHalted={syncHalted}
          lastSynced={lastSynced}
          onClose={() => setCloudSyncOpen(false)}
        />
      )}
      {autoBackupOpen && (
        <AutoBackupModal
          onClose={() => setAutoBackupOpen(false)}
        />
      )}
    </div>
  )
}
