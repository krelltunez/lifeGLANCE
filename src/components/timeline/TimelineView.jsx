import React, { useState, useRef, useCallback, useEffect } from 'react'
import Timeline          from './Timeline'
import StatsPanel        from '../stats/StatsPanel'
import AddMilestoneSheet from '../milestone/AddMilestoneSheet'
import MilestoneDetail   from '../milestone/MilestoneDetail'
import SettingsModal     from '../settings/SettingsModal'
import HelpModal         from '../help/HelpModal'
import MinimapBar        from '../minimap/MinimapBar'
import TypewriterText    from '../ui/TypewriterText'
import { ZOOM_LEVELS }   from '../../utils/timeline'
import { loadCategories } from '../../utils/colors'
import { addMilestone, updateMilestone, deleteMilestone, restoreMilestones } from '../../data/milestones'

const ZOOM_RANK = { decades: 5, '30yr': 4, years: 3, months: 2, weeks: 1, custom: 3.5 }

const TEXT_SIZES = {
  small:  '19px',
  normal: '22px',
  big:    '26px',
  bigger: '30px',
}

const ZOOM_ANIM_MS = 380

export default function TimelineView({ milestones, setMilestones }) {
  const [zoom,          setZoom]          = useState('years')
  const [zoomAnim,      setZoomAnim]      = useState('')
  const [filter,        setFilter]        = useState('all')
  const [addOpen,       setAddOpen]       = useState(false)
  const [editTarget,    setEditTarget]    = useState(null)
  const [detail,        setDetail]        = useState(null)
  const [textSize,      setTextSize]      = useState(
    () => localStorage.getItem('lifeglance-text-size') || 'normal'
  )
  const [customYears,   setCustomYears]   = useState(15)
  const [pastIdx,       setPastIdx]       = useState(0)
  const [futureIdx,     setFutureIdx]     = useState(0)
  const [selectedId,    setSelectedId]    = useState(null)
  const [highlightsActive, setHighlightsActive] = useState(true)
  const [settingsOpen,  setSettingsOpen]  = useState(false)
  const [helpOpen,      setHelpOpen]      = useState(false)
  const [viewMode,      setViewMode]      = useState('all')
  const [categories,    setCategories]    = useState(loadCategories)
  const [panMs,         setPanMs]         = useState(0)
  const [clustering,    setClustering]    = useState(
    () => localStorage.getItem('lifeglance-clustering') !== 'false'
  )

  const timelineRef   = useRef(null)
  const zoomWrapRef   = useRef(null)
  const zoomRef       = useRef('years')
  const zoomLocked    = useRef(false)
  const customInputRef = useRef(null)

  // Apply font size globally
  useEffect(() => {
    document.documentElement.style.fontSize = TEXT_SIZES[textSize]
    localStorage.setItem('lifeglance-text-size', textSize)
  }, [textSize])

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
  const filteredMilestones = filter === 'all'
    ? milestones
    : milestones.filter(m => m.category === filter)

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

  // ── View mode ────────────────────────────────────────────────────────────────
  function handleViewMode(mode) {
    setViewMode(mode)
    setPanMs(0)
    if (timelineRef.current) timelineRef.current.resetPan()
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  // Use a ref so the listener is registered once but always sees fresh state
  const keyStateRef = useRef(null)
  keyStateRef.current = {
    pastIdx, futureIdx, past, future, zoom,
    addOpen, detail, settingsOpen, helpOpen,
    handlePastNav, handleFutureNav, handleJumpToToday, handleViewMode, closeSheet,
  }

  useEffect(() => {
    function onKey(e) {
      // Allow Escape through even when an input is focused (to close modals)
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && e.key !== 'Escape') return
      const s = keyStateRef.current
      const anyModal = s.addOpen || !!s.detail || s.settingsOpen || s.helpOpen

      switch (e.key) {
        case 'ArrowLeft': {
          if (anyModal) break
          e.preventDefault()
          if (s.past.length > 0) s.handlePastNav((s.pastIdx + 1) % s.past.length)
          break
        }
        case 'ArrowRight': {
          if (anyModal) break
          e.preventDefault()
          if (s.future.length > 0) s.handleFutureNav((s.futureIdx + 1) % s.future.length)
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
        case '?': {
          if (s.addOpen || !!s.detail || s.settingsOpen) break
          if (!s.helpOpen) setHelpOpen(true)
          break
        }
        case '1': case '2': case '3': case '4': case '5':
        case '6': case '7': case '8': case '9': {
          if (anyModal) break
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
        case 'Escape': {
          if (s.detail)            setDetail(null)
          else if (s.addOpen)      s.closeSheet()
          else if (s.settingsOpen) setSettingsOpen(false)
          else if (s.helpOpen)     setHelpOpen(false)
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
    if (existing) {
      const updated = await updateMilestone(existing.id, data, existing)
      setMilestones(prev => prev.map(m => m.id === existing.id ? updated : m))
    } else {
      const m = await addMilestone(data)
      setMilestones(prev => [...prev, m])
    }
  }

  async function handleDelete(id) {
    await deleteMilestone(id)
    setMilestones(prev => prev.filter(m => m.id !== id))
  }

  function openEdit(m)  { setEditTarget(m); setAddOpen(true) }
  function closeSheet() { setAddOpen(false); setEditTarget(null) }

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

  async function handleRestoreFile(e) {
    const file = e.target.files[0]
    if (!file) return
    try {
      const text     = await file.text()
      const data     = JSON.parse(text)
      const restored = await restoreMilestones(data)
      setMilestones(restored)
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

          <div className="view-tabs">
            {[['past', '← past'], ['all', '← all →'], ['future', 'future →']].map(([mode, label]) => (
              <button key={mode}
                className={`view-tab ${viewMode === mode ? 'active' : ''}`}
                onClick={() => handleViewMode(mode)}>{label}</button>
            ))}
          </div>
        </div>

        {/* Right: settings + help */}
        <div className="header-right">
          <button className="action-link" onClick={() => setSettingsOpen(true)}>settings</button>
          <span className="action-sep">|</span>
          <button className="action-link" onClick={() => setHelpOpen(true)}>?</button>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="timeline-body">
        {!isEmpty && (
          <StatsPanel
            past={past} future={future}
            pastIdx={pastIdx} futureIdx={futureIdx}
            onPastChange={handlePastNav}
            onFutureChange={handleFutureNav}
            viewMode={viewMode}
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
        />
      )}
      {helpOpen && (
        <HelpModal onClose={() => setHelpOpen(false)} />
      )}
      {settingsOpen && (
        <SettingsModal
          textSize={textSize}       onTextSizeChange={setTextSize}
          categories={categories}   onCategoriesChange={setCategories}
          clustering={clustering}   onClusteringChange={v => {
            setClustering(v)
            localStorage.setItem('lifeglance-clustering', String(v))
          }}
          milestones={milestones}
          onSaveBackup={handleSaveBackup}
          onRestoreFile={handleRestoreFile}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
