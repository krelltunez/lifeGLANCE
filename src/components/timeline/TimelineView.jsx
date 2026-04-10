import React, { useState, useRef, useCallback, useEffect } from 'react'
import Timeline          from './Timeline'
import StatsPanel        from '../stats/StatsPanel'
import AddMilestoneSheet from '../milestone/AddMilestoneSheet'
import MilestoneDetail   from '../milestone/MilestoneDetail'
import { ZOOM_LEVELS }   from '../../utils/timeline'
import { addMilestone, updateMilestone, deleteMilestone } from '../../data/milestones'

const ZOOM_RANK = { decades: 4, years: 3, months: 2, weeks: 1 }

const TEXT_SIZES = {
  small:  '19px',
  normal: '22px',
  big:    '26px',
  bigger: '30px',
}

export default function TimelineView({ milestones, setMilestones }) {
  const [zoom,        setZoom]      = useState('years')
  const [zoomAnim,    setZoomAnim]  = useState('')
  const [addOpen,     setAddOpen]   = useState(false)
  const [editTarget,  setEditTarget] = useState(null)
  const [detail,      setDetail]    = useState(null)
  const [textSize,    setTextSize]  = useState(
    () => localStorage.getItem('lifeglance-text-size') || 'normal'
  )
  const timelineRef = useRef(null)

  // Apply font size to root whenever it changes
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
    }, 130)
  }, [zoom])

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

  function openEdit(m) {
    setEditTarget(m)
    setAddOpen(true)
  }

  function closeSheet() {
    setAddOpen(false)
    setEditTarget(null)
  }

  const isEmpty = milestones.length === 0

  return (
    <div className="timeline-view">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="timeline-header">
        <div className="logo logo-sm">
          <span className="logo-life">life</span>
          <span className="logo-glance">GLANCE</span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {/* Text size controls */}
          <div className="zoom-tabs">
            {Object.keys(TEXT_SIZES).map(s => (
              <button
                key={s}
                className={`zoom-tab ${textSize === s ? 'active' : ''}`}
                onClick={() => setTextSize(s)}
                title={`Text size: ${s}`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Zoom level controls */}
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
          </div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="timeline-body">
        {/* Stat panels overlay (top corners) */}
        {!isEmpty && <StatsPanel milestones={milestones} />}

        {/* Timeline with zoom animation wrapper */}
        <div className={`timeline-zoom-wrap ${zoomAnim}`}>
          <Timeline
            ref={timelineRef}
            milestones={milestones}
            zoom={zoom}
            textSize={textSize}
            onMilestoneClick={setDetail}
          />
        </div>

        {/* Empty state */}
        {isEmpty && (
          <div className="empty-state">
            <div className="empty-state-label">
              no milestones yet.<br />
              add one to start your timeline.
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom bar ─────────────────────────────────────────────────────── */}
      <div className="timeline-bottom">
        <button className="add-milestone-btn" onClick={() => setAddOpen(true)}>
          + add milestone
        </button>
        <button
          className="today-btn"
          onClick={() => timelineRef.current?.resetPan()}
        >
          jump to today
        </button>
      </div>

      {/* ── Sheets ─────────────────────────────────────────────────────────── */}
      {addOpen && (
        <AddMilestoneSheet
          onSave={handleSave}
          onClose={closeSheet}
          existing={editTarget}
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
    </div>
  )
}
