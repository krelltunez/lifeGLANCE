import React, { useState, useRef, useCallback, useEffect } from 'react'
import Timeline          from './Timeline'
import StatsPanel        from '../stats/StatsPanel'
import AddMilestoneSheet from '../milestone/AddMilestoneSheet'
import MilestoneDetail   from '../milestone/MilestoneDetail'
import TypewriterText    from '../ui/TypewriterText'
import { ZOOM_LEVELS }   from '../../utils/timeline'
import { CATEGORIES }    from '../../utils/colors'
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
  const [zoom,        setZoom]       = useState('years')
  const [zoomAnim,    setZoomAnim]   = useState('')
  const [filter,      setFilter]     = useState('all')
  const [addOpen,     setAddOpen]    = useState(false)
  const [editTarget,  setEditTarget] = useState(null)
  const [detail,      setDetail]     = useState(null)
  const [textSize,    setTextSize]   = useState(
    () => localStorage.getItem('lifeglance-text-size') || 'normal'
  )
  const [customYears, setCustomYears] = useState(15)
  const [pastIdx,     setPastIdx]    = useState(0)
  const [futureIdx,   setFutureIdx]  = useState(0)
  const [selectedId,  setSelectedId] = useState(null)

  const timelineRef = useRef(null)
  const zoomWrapRef = useRef(null)
  const zoomRef     = useRef('years')
  const zoomLocked  = useRef(false)
  const restoreRef  = useRef(null)

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
  const presentCategories = CATEGORIES.filter(cat =>
    milestones.some(m => m.category === cat.id)
  )
  const filteredMilestones = filter === 'all'
    ? milestones
    : milestones.filter(m => m.category === filter)

  // ── Past / future for stat panel ─────────────────────────────────────────────
  const now    = new Date()
  const past   = [...filteredMilestones]
    .filter(m => new Date(m.date) < now)
    .sort((a, b) => new Date(b.date) - new Date(a.date))   // most-recent first
  const future = [...filteredMilestones]
    .filter(m => new Date(m.date) >= now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))   // soonest first

  // Clamp indices when lists shrink (filter change, deletion)
  useEffect(() => {
    setPastIdx(i => Math.min(i, Math.max(0, past.length - 1)))
  }, [past.length])
  useEffect(() => {
    setFutureIdx(i => Math.min(i, Math.max(0, future.length - 1)))
  }, [future.length])

  const highlightedIds = new Set(
    [past[pastIdx]?.id, future[futureIdx]?.id].filter(Boolean)
  )

  // ── Milestone click: first click selects + centers, second click opens detail ─
  function handleMilestoneClick(m) {
    if (selectedId === m.id) {
      setDetail(m)
    } else {
      setSelectedId(m.id)
      timelineRef.current?.panToMs(new Date(m.date).getTime())
      // Sync stat panel to the selected milestone
      const pastI = past.findIndex(p => p.id === m.id)
      if (pastI !== -1) {
        setPastIdx(pastI)
      } else {
        const futureI = future.findIndex(f => f.id === m.id)
        if (futureI !== -1) setFutureIdx(futureI)
      }
    }
  }

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
    // Use local date so the filename matches the user's calendar day
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

  return (
    <div className="timeline-view">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="timeline-header">
        <div className="logo logo-sm">
          <span className="logo-life">life</span>
          <span className="logo-glance">GLANCE</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {/* Text size */}
            <div className="zoom-tabs">
              {Object.keys(TEXT_SIZES).map(s => (
                <button key={s}
                  className={`zoom-tab ${textSize === s ? 'active' : ''}`}
                  onClick={() => setTextSize(s)}>{s}</button>
              ))}
            </div>

            {/* Zoom level */}
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
          </div>

          {/* Zoom indicator / custom input */}
          <div className="zoom-indicator">
            {zoom === 'custom' ? (
              <div className="custom-zoom-row">
                <span>±</span>
                <input className="custom-zoom-input" type="number" min="1" max="200"
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

          {/* Backup links */}
          <div className="header-actions">
            <button className="action-link" onClick={handleSaveBackup}>save backup</button>
            <span className="action-sep">·</span>
            <button className="action-link" onClick={() => restoreRef.current?.click()}>restore</button>
            <input ref={restoreRef} type="file" accept=".json"
              style={{ display: 'none' }} onChange={handleRestoreFile} />
          </div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="timeline-body">
        {!isEmpty && (
          <StatsPanel
            past={past} future={future}
            pastIdx={pastIdx} futureIdx={futureIdx}
            onPastChange={i => {
              const clamped = Math.max(0, Math.min(i, past.length - 1))
              setPastIdx(clamped)
              setSelectedId(null)
              const m = past[clamped]
              if (m) timelineRef.current?.panToMs(new Date(m.date).getTime())
            }}
            onFutureChange={i => {
              const clamped = Math.max(0, Math.min(i, future.length - 1))
              setFutureIdx(clamped)
              setSelectedId(null)
              const m = future[clamped]
              if (m) timelineRef.current?.panToMs(new Date(m.date).getTime())
            }}
          />
        )}

        <div ref={zoomWrapRef} className={`timeline-zoom-wrap ${zoomAnim}`}>
          <Timeline
            ref={timelineRef}
            milestones={filteredMilestones}
            zoom={zoom}
            textSize={textSize}
            customHalfMs={customYears * 365.25 * 24 * 3600 * 1000}
            highlightedIds={highlightedIds}
            onMilestoneClick={handleMilestoneClick}
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

        <button className="today-btn" onClick={() => timelineRef.current?.resetPan()}>
          jump to today
        </button>
      </div>

      {/* ── Sheets ─────────────────────────────────────────────────────────── */}
      {addOpen && (
        <AddMilestoneSheet onSave={handleSave} onClose={closeSheet} existing={editTarget} />
      )}
      {detail && (
        <MilestoneDetail
          milestone={detail}
          onClose={() => setDetail(null)}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
