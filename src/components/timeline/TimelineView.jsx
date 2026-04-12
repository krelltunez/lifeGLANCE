import React, { useState, useRef, useCallback, useEffect } from 'react'
import Timeline          from './Timeline'
import StatsPanel        from '../stats/StatsPanel'
import AddMilestoneSheet from '../milestone/AddMilestoneSheet'
import MilestoneDetail   from '../milestone/MilestoneDetail'
import SettingsModal     from '../settings/SettingsModal'
import HelpModal         from '../help/HelpModal'
import SearchModal       from '../search/SearchModal'
import SummaryModal      from '../stats/SummaryModal'
import OnThisDayModal    from './OnThisDayModal'
import IcsImportModal    from '../import/IcsImportModal'
import MinimapBar        from '../minimap/MinimapBar'
import TypewriterText    from '../ui/TypewriterText'
import { ZOOM_LEVELS }   from '../../utils/timeline'
import { loadCategories } from '../../utils/colors'
import { addMilestone, updateMilestone, deleteMilestone, restoreMilestones } from '../../data/milestones'
import { parseIcs }      from '../../utils/icsParser'
import * as audio from '../../utils/audio'

const ZOOM_RANK = { decades: 5, '30yr': 4, years: 3, months: 2, weeks: 1, custom: 3.5 }

const TEXT_SIZES = {
  small:  '19px',
  normal: '22px',
  big:    '26px',
  bigger: '30px',
}

const ZOOM_ANIM_MS = 380

function applyRecurFilter(ms, mode) {
  if (mode === 'all') return ms
  const now    = new Date()
  const nonRec = ms.filter(m => !m.recurrence_id)
  const rec    = ms.filter(m =>  m.recurrence_id)
  if (mode === 'past')   return [...nonRec, ...rec.filter(m => new Date(m.date) <  now)]
  if (mode === 'future') return [...nonRec, ...rec.filter(m => new Date(m.date) >= now)]
  // 'next': one instance per series — nearest upcoming, or most recent past if none upcoming
  const byId = {}
  for (const m of rec) { (byId[m.recurrence_id] ??= []).push(m) }
  const picked = Object.values(byId).map(arr => {
    const up = arr.filter(m => new Date(m.date) >= now).sort((a, b) => new Date(a.date) - new Date(b.date))
    return up.length ? up[0] : arr.sort((a, b) => new Date(b.date) - new Date(a.date))[0]
  })
  return [...nonRec, ...picked]
}

export default function TimelineView({ milestones, setMilestones }) {
  const [zoom,          setZoom]          = useState('years')
  const [zoomAnim,      setZoomAnim]      = useState('')
  const [filter,        setFilter]        = useState('all')
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
  const [newlyAddedId,  setNewlyAddedId]  = useState(null)
  const [summaryOpen,   setSummaryOpen]   = useState(false)
  const [onThisDayOpen, setOnThisDayOpen] = useState(false)
  const [icsImport,     setIcsImport]     = useState(null)  // { candidates, timedCount } | null

  const timelineRef    = useRef(null)
  const zoomWrapRef    = useRef(null)
  const bodyRef        = useRef(null)
  const zoomRef        = useRef('years')
  const zoomLocked     = useRef(false)
  const customInputRef = useRef(null)
  const historyRef     = useRef(null)   // { stack: Milestone[][], idx: number }

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

  // ── Filter ───────────────────────────────────────────────────────────────────
  const presentCategories = categories.filter(cat =>
    milestones.some(m => m.category === cat.id)
  )
  const hasRecurring = milestones.some(m => m.recurrence_id)
  const categoryFiltered = filter === 'all' ? milestones : milestones.filter(m => m.category === filter)
  const filteredMilestones = applyRecurFilter(categoryFiltered, recurFilter)

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
    addOpen, detail, settingsOpen, helpOpen, searchOpen,
    handlePastNav, handleFutureNav, handleJumpToToday, handleViewMode, closeSheet,
    handleUndo, handleRedo, canUndo, canRedo,
    clustering, setClustering,
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
      const anyModal = s.addOpen || !!s.detail || s.settingsOpen || s.helpOpen || s.searchOpen

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
        case 'n': case 'N': {
          if (s.settingsOpen || !!s.detail) break
          if (!s.addOpen) { e.preventDefault(); setAddOpen(true) }
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
        case '/': {
          e.preventDefault() // prevent browser Quick Find (Firefox etc.) regardless
          if (s.addOpen || !!s.detail || s.settingsOpen || s.helpOpen) break
          if (!s.searchOpen) setSearchOpen(true)
          break
        }
        case '?': {
          if (s.addOpen || !!s.detail || s.settingsOpen || s.searchOpen) break
          if (!s.helpOpen) setHelpOpen(true)
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
            break
          }
          if (s.detail)            setDetail(null)
          else if (s.addOpen)      s.closeSheet()
          else if (s.settingsOpen) setSettingsOpen(false)
          else if (s.helpOpen)     setHelpOpen(false)
          else if (s.searchOpen)   setSearchOpen(false)
          break
        }
        default: break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // stable — reads fresh values from keyStateRef

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  async function handleSave(data, existing) {
    audio.init()   // ensure AudioContext is running (form submit = user gesture)
    if (existing) {
      const updated = await updateMilestone(existing.id, data, existing)
      const newMs = milestones.map(m => m.id === existing.id ? updated : m)
      pushHistory(newMs)
      setMilestones(newMs)
      audio.playEditSave()
    } else if (data.recurrence === 'annual') {
      // Generate one instance per year from base year to chosen end year (max +99)
      const rid       = crypto.randomUUID()
      const baseDate  = new Date(data.date)
      const baseYear  = baseDate.getFullYear()
      const endYear   = Math.max(baseYear, Math.min(
        data.recurrenceEndYear ?? Math.max(baseYear, new Date().getFullYear()) + 3,
        baseYear + 99
      ))
      const created   = []
      for (let y = baseYear; y <= endYear; y++) {
        const d = new Date(baseDate)
        d.setFullYear(y)
        const m = await addMilestone({
          ...data,
          date:          d,
          recurrence_id: rid,
          // only the base-year instance keeps the original note / photo / url
          note:      y === baseYear ? data.note      : '',
          photo_uri: y === baseYear ? data.photo_uri : '',
          url:       y === baseYear ? data.url       : '',
        })
        created.push(m)
      }
      const newMs = [...milestones, ...created]
      pushHistory(newMs)
      setMilestones(newMs)
      setNewlyAddedId(created[0].id)
      audio.playChime()
    } else {
      const m = await addMilestone(data)
      const newMs = [...milestones, m]
      pushHistory(newMs)
      setMilestones(newMs)
      setNewlyAddedId(m.id)
      audio.playChime()
    }
  }

  async function handleDelete(id) {
    await deleteMilestone(id)
    const newMs = milestones.filter(m => m.id !== id)
    pushHistory(newMs)
    setMilestones(newMs)
  }

  async function handleDeleteSeries(recurrence_id) {
    const toDelete = milestones.filter(m => m.recurrence_id === recurrence_id)
    for (const m of toDelete) await deleteMilestone(m.id)
    const newMs = milestones.filter(m => m.recurrence_id !== recurrence_id)
    pushHistory(newMs)
    setMilestones(newMs)
  }

  function openEdit(m)  { setEditTarget(m); setAddOpen(true) }
  function closeSheet() { setAddOpen(false); setEditTarget(null) }

  // ── Export image ─────────────────────────────────────────────────────────────
  async function handleExportImage() {
    const svgEl = zoomWrapRef.current?.querySelector('svg')
    if (!svgEl) return
    try {
      const { width: w, height: h } = svgEl.getBoundingClientRect()
      const scale = 2

      // Clone SVG, fix rem font-size (canvas defaults 1rem→16px, not the app's value),
      // and inject a dark background rect.
      const clone = svgEl.cloneNode(true)
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      clone.setAttribute('width', w)
      clone.setAttribute('height', h)
      clone.style.fontSize = getComputedStyle(svgEl).fontSize // e.g. "22px"

      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      bg.setAttribute('width', '100%')
      bg.setAttribute('height', '100%')
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
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')
      ctx.scale(scale, scale)

      await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => { ctx.drawImage(img, 0, 0); URL.revokeObjectURL(svgUrl); resolve() }
        img.onerror = reject
        img.src = svgUrl
      })

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
  function handleSaveBackup() {
    const json = JSON.stringify(milestones, null, 2)
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
    for (const row of selected) {
      const m = await addMilestone({
        title:          row.title,
        date:           row.date,
        date_precision: 'day',
        category:       row.category,
        note:           row.note,
        url:            row.url,
      })
      added.push(m)
    }
    const newMs = [...milestones, ...added]
    pushHistory(newMs)
    setMilestones(newMs)
    setIcsImport(null)
  }

  async function handleRestoreFile(e) {
    const file = e.target.files[0]
    if (!file) return
    try {
      const text     = await file.text()
      const data     = JSON.parse(text)
      const restored = await restoreMilestones(data)
      setMilestones(restored)
      historyRef.current = { stack: [restored], idx: 0 }
      setCanUndo(false)
      setCanRedo(false)
    } catch (err) {
      console.error('Restore failed:', err)
    }
    e.target.value = ''
  }

  const isEmpty = filteredMilestones.length === 0 && milestones.length === 0
  const customHalfMs = customYears * 365.25 * 24 * 3600 * 1000

  return (
    <div className="timeline-view">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="timeline-header">
        {/* Left: logo */}
        <div className="logo logo-sm">
          <span className="logo-life">life</span>
          <span className="logo-glance">GLANCE</span>
        </div>

        {/* Center: zoom row + view picker */}
        <div className="header-center">
          {compactHeader ? (
            /* Single row on narrow screens: zoom ▾  |  past ↺  |  rec: next */
            <div className="compact-controls-row">
              <div className="zoom-dropdown-wrap" onClick={e => e.stopPropagation()}>
                <button
                  className="zoom-tab active zoom-dropdown-btn"
                  onClick={() => setZoomOpen(o => !o)}>
                  {zoom === 'custom' ? 'custom' : zoom} ▾
                </button>
                {zoomOpen && (
                  <div className="zoom-dropdown">
                    {[...ZOOM_LEVELS, 'custom'].map(z => (
                      <button key={z}
                        className={`zoom-dropdown-item ${zoom === z ? 'active' : ''}`}
                        onClick={() => { handleZoom(z); setZoomOpen(false) }}>
                        {z}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {zoom === 'custom' && (
                <div className="custom-zoom-row">
                  <span>±</span>
                  <input ref={customInputRef} autoFocus
                    className="custom-zoom-input" type="number" min="1" max="200"
                    value={customYears}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10)
                      if (!isNaN(v)) setCustomYears(Math.max(1, Math.min(200, v)))
                    }} />
                  <span>yr</span>
                </div>
              )}
              <button
                className="zoom-tab active view-cycle-btn"
                onClick={() => handleViewMode(
                  viewMode === 'past' ? 'all' : viewMode === 'all' ? 'future' : 'past'
                )}>
                {viewMode} ↺
              </button>
              {hasRecurring && (
                <button
                  className={`recur-filter-btn${recurFilter !== 'next' ? ' active' : ''}`}
                  onClick={cycleRecurFilter}>
                  rec: {recurFilter}
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
                      onClick={() => handleZoom(z)}>{z}</button>
                  ))}
                  <button
                    className={`zoom-tab ${zoom === 'custom' ? 'active' : ''}`}
                    onClick={() => handleZoom('custom')}>custom</button>
                </div>
                <div className="zoom-indicator">
                  {zoom === 'custom' ? (
                    <div className="custom-zoom-row">
                      <span>±</span>
                      <input ref={customInputRef} autoFocus
                        className="custom-zoom-input" type="number" min="1" max="200"
                        value={customYears}
                        onChange={e => {
                          const v = parseInt(e.target.value, 10)
                          if (!isNaN(v)) setCustomYears(Math.max(1, Math.min(200, v)))
                        }} />
                      <span>yr</span>
                    </div>
                  ) : (
                    <TypewriterText key={zoom} text={`viewing: ${zoom}`}
                      options={{ delay: 38, jitter: 18 }} showCursor={false} hideCursorWhenDone />
                  )}
                </div>
              </div>
              <div className="view-tabs-row">
                <div className="view-tabs">
                  {[['past', '← past'], ['all', '← all →'], ['future', 'future →']].map(([mode, label]) => (
                    <button key={mode}
                      className={`view-tab ${viewMode === mode ? 'active' : ''}`}
                      onClick={() => handleViewMode(mode)}>{label}</button>
                  ))}
                </div>
                {hasRecurring && (
                  <button
                    className={`recur-filter-btn${recurFilter !== 'next' ? ' active' : ''}`}
                    onClick={cycleRecurFilter}>
                    recurring: {recurFilter}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right: stats + settings + help */}
        <div className="header-right">
          <button className="action-link" onClick={() => setSummaryOpen(true)}>stats</button>
          <span className="action-sep">|</span>
          <button className="action-link" onClick={() => setSettingsOpen(true)}>settings</button>
          <span className="action-sep">|</span>
          <button className="action-link" onClick={() => setHelpOpen(true)}>?</button>
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

        <div ref={zoomWrapRef} className={`timeline-zoom-wrap ${zoomAnim}`}>
          <Timeline
            ref={timelineRef}
            milestones={filteredMilestones}
            zoom={zoom}
            textSize={textSize}
            customHalfMs={customHalfMs}
            highlightedIds={highlightedIds}
            onMilestoneClick={handleMilestoneClick}
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
              no milestones yet.<br />add one to start your timeline.
            </div>
          </div>
        )}
        {!isEmpty && filteredMilestones.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-label">no milestones in this category.</div>
          </div>
        )}
      </div>

      {/* ── Minimap ────────────────────────────────────────────────────────── */}
      {!isEmpty && (
        <MinimapBar
          milestones={filteredMilestones}
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
          + add milestone
        </button>

        {presentCategories.length > 0 && (
          compactFilter ? (
            <div className="filter-compact" onClick={e => e.stopPropagation()}>
              <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`}
                onClick={() => { setFilter('all'); setFilterOpen(false) }}>all</button>
              <div className="filter-dropdown-wrap">
                <button
                  className={`filter-chip filter-dropdown-btn ${filter !== 'all' ? 'active' : ''}`}
                  onClick={() => setFilterOpen(o => !o)}>
                  {filter !== 'all' ? (
                    <>
                      <span className="filter-dot"
                        style={{ background: presentCategories.find(c => c.id === filter)?.color }} />
                      {presentCategories.find(c => c.id === filter)?.label}
                    </>
                  ) : 'category'} ▾
                </button>
                {filterOpen && (
                  <div className="filter-dropdown">
                    {presentCategories.map(cat => (
                      <button key={cat.id}
                        className={`filter-dropdown-item ${filter === cat.id ? 'active' : ''}`}
                        onClick={() => { setFilter(cat.id); setFilterOpen(false) }}>
                        <span className="filter-dot" style={{ background: cat.color }} />
                        {cat.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="filter-chips-inline">
              <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}>all</button>
              {presentCategories.map(cat => (
                <button key={cat.id}
                  className={`filter-chip ${filter === cat.id ? 'active' : ''}`}
                  onClick={() => setFilter(filter === cat.id ? 'all' : cat.id)}>
                  <span className="filter-dot" style={{ background: cat.color }} />
                  {cat.label}
                </button>
              ))}
            </div>
          )
        )}

        {onThisDayItems.length > 0 && (
          <button className="today-btn otd-btn" onClick={() => setOnThisDayOpen(true)}>
            on this day
          </button>
        )}
        <button className="today-btn" onClick={handleJumpToToday}>
          jump to today
        </button>
      </div>

      {/* ── Sheets ─────────────────────────────────────────────────────────── */}
      {addOpen && (
        <AddMilestoneSheet
          onSave={handleSave} onClose={closeSheet} existing={editTarget}
          categories={categories}
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
        />
      )}
      {searchOpen && (
        <SearchModal
          milestones={milestones}
          onSelect={handleSearchSelect}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {helpOpen && (
        <HelpModal onClose={() => setHelpOpen(false)} />
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
          }}
          milestones={milestones}
          onExportImage={handleExportImage}
          onSaveBackup={handleSaveBackup}
          onRestoreFile={handleRestoreFile}
          onImportIcsFile={handleImportIcsFile}
          onClose={() => setSettingsOpen(false)}
        />
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
    </div>
  )
}
