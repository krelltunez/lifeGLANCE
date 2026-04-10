import React, { useState, useRef, useCallback, useEffect } from 'react'
import Timeline          from './Timeline'
import StatsPanel        from '../stats/StatsPanel'
import AddMilestoneSheet from '../milestone/AddMilestoneSheet'
import MilestoneDetail   from '../milestone/MilestoneDetail'
import TypewriterText    from '../ui/TypewriterText'
import { ZOOM_LEVELS }   from '../../utils/timeline'
import { CATEGORIES }    from '../../utils/colors'
import { addMilestone, updateMilestone, deleteMilestone } from '../../data/milestones'

const ZOOM_RANK = { decades: 5, '30yr': 4, years: 3, months: 2, weeks: 1, custom: 3.5 }

const TEXT_SIZES = {
  small:  '19px',
  normal: '22px',
  big:    '26px',
  bigger: '30px',
}

// Zoom animation duration must match CSS transition duration
const ZOOM_ANIM_MS = 380

export default function TimelineView({ milestones, setMilestones }) {
  const [zoom,       setZoom]      = useState('years')
  const [zoomAnim,   setZoomAnim]  = useState('')
  const [filter,     setFilter]    = useState('all')
  const [addOpen,    setAddOpen]   = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [detail,     setDetail]    = useState(null)
  const [textSize,   setTextSize]  = useState(
    () => localStorage.getItem('lifeglance-text-size') || 'normal'
  )
  const [customYears, setCustomYears] = useState(15)   // ±15 yr = 30-year window
  const timelineRef  = useRef(null)
  const zoomWrapRef  = useRef(null)
  const zoomRef      = useRef('years')   // mirrors zoom state, readable in event handlers
  const zoomLocked   = useRef(false)     // throttle: one zoom step per animation

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
    setTimeout(() => {
      setZoom(newZoom)
      setZoomAnim('')
    }, ZOOM_ANIM_MS)
  }, [zoom])

  // Keep ref in sync so the wheel handler always sees current zoom
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  // Stable ref to handleZoom so the wheel effect doesn't re-subscribe on every zoom change
  const handleZoomRef = useRef(handleZoom)
  useEffect(() => { handleZoomRef.current = handleZoom }, [handleZoom])

  // ── Wheel zoom ───────────────────────────────────────────────────────────────
  // Must be a non-passive listener to call preventDefault (stops page scroll)
  useEffect(() => {
    const el = zoomWrapRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      if (zoomLocked.current) return
      const idx     = ZOOM_LEVELS.indexOf(zoomRef.current)
      // scroll up (deltaY < 0) → zoom in → toward 'weeks' (higher index)
      // scroll down (deltaY > 0) → zoom out → toward 'decades' (lower index)
      const nextIdx = e.deltaY < 0 ? idx + 1 : idx - 1
      if (nextIdx < 0 || nextIdx >= ZOOM_LEVELS.length) return
      zoomLocked.current = true
      setTimeout(() => { zoomLocked.current = false }, ZOOM_ANIM_MS + 60)
      handleZoomRef.current(ZOOM_LEVELS[nextIdx])
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, []) // stable refs — no deps needed

  // ── Filter ───────────────────────────────────────────────────────────────────
  // Only show filter chips for categories that appear in the data
  const presentCategories = CATEGORIES.filter(cat =>
    milestones.some(m => m.category === cat.id)
  )
  const filteredMilestones = filter === 'all'
    ? milestones
    : milestones.filter(m => m.category === filter)

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

  function openEdit(m) { setEditTarget(m); setAddOpen(true) }
  function closeSheet() { setAddOpen(false); setEditTarget(null) }

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
                <button
                  key={s}
                  className={`zoom-tab ${textSize === s ? 'active' : ''}`}
                  onClick={() => setTextSize(s)}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Zoom level */}
            <div className="zoom-tabs">
              {ZOOM_LEVELS.map(z => (
                <button
                  key={z}
                  className={`zoom-tab ${zoom === z ? 'active' : ''}`}
                  onClick={() => handleZoom(z)}
                >
                  {z}
                </button>
              ))}
              <button
                className={`zoom-tab ${zoom === 'custom' ? 'active' : ''}`}
                onClick={() => handleZoom('custom')}
              >
                custom
              </button>
            </div>
          </div>

          {/* Zoom indicator / custom range input */}
          <div className="zoom-indicator">
            {zoom === 'custom' ? (
              <div className="custom-zoom-row">
                <span>±</span>
                <input
                  className="custom-zoom-input"
                  type="number"
                  min="1"
                  max="200"
                  value={customYears}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v)) setCustomYears(Math.max(1, Math.min(200, v)))
                  }}
                />
                <span>yr</span>
              </div>
            ) : (
              <TypewriterText
                key={zoom}
                text={`viewing: ${zoom}`}
                options={{ delay: 38, jitter: 18 }}
                showCursor={false}
                hideCursorWhenDone
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="timeline-body">
        {!isEmpty && <StatsPanel milestones={filteredMilestones} />}

        <div ref={zoomWrapRef} className={`timeline-zoom-wrap ${zoomAnim}`}>
          <Timeline
            ref={timelineRef}
            milestones={filteredMilestones}
            zoom={zoom}
            textSize={textSize}
            customHalfMs={customYears * 365.25 * 24 * 3600 * 1000}
            onMilestoneClick={setDetail}
          />
        </div>

        {isEmpty && (
          <div className="empty-state">
            <div className="empty-state-label">
              no milestones yet.<br />
              add one to start your timeline.
            </div>
          </div>
        )}

        {!isEmpty && filteredMilestones.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-label">
              no milestones in this category.
            </div>
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
            <button
              className={`filter-chip ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              all
            </button>
            {presentCategories.map(cat => (
              <button
                key={cat.id}
                className={`filter-chip ${filter === cat.id ? 'active' : ''}`}
                onClick={() => setFilter(filter === cat.id ? 'all' : cat.id)}
              >
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
