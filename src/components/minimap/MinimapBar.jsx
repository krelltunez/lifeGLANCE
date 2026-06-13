import React, { useRef, useState, useEffect } from 'react'
import { getTimeRangeForView } from '../../utils/timeline'

const H         = 40
const BAND_H    = 3   // chapter band height px
const BAND_GAP  = 2   // gap between stacked bands
const BAND_TOP  = 24  // y of first (topmost) band row, below the axis
const MAX_ROWS  = 3

export default function MinimapBar({ milestones, chapters = [], panMs, onPanDirect, panToMs, zoom, customHalfMs, viewMode = 'all' }) {
  const wrapRef = useRef(null)
  const [w, setW] = useState(800)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new ResizeObserver(([e]) => setW(e.contentRect.width))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const todayMs = Date.now()

  // Full time range: span all milestones + today, with padding
  const allMs = milestones.map(m => new Date(m.date).getTime())
  const dataMin = allMs.length ? Math.min(...allMs) : todayMs - 3 * 365.25 * 24 * 3600 * 1000
  const dataMax = allMs.length ? Math.max(...allMs) : todayMs + 3 * 365.25 * 24 * 3600 * 1000
  const span    = Math.max(dataMax - dataMin, 365.25 * 24 * 3600 * 1000)
  const pad     = span * 0.12
  const mapStart = Math.min(dataMin, todayMs) - pad
  const mapEnd   = Math.max(dataMax, todayMs) + pad
  const mapSpan  = mapEnd - mapStart

  const msToX = (ms) => ((ms - mapStart) / mapSpan) * w
  const xToMs = (x)  => mapStart + (x / w) * mapSpan

  // Current viewport rect
  const centerMs = todayMs + panMs
  const { startMs: vsStart, endMs: vsEnd } = getTimeRangeForView(zoom, centerMs, viewMode, customHalfMs)
  const vx1 = Math.max(0,  msToX(vsStart))
  const vx2 = Math.min(w,  msToX(vsEnd))

  const todayX = msToX(todayMs)

  // Assign chapter rows using greedy interval coloring (same as main timeline).
  // Capped at MAX_ROWS so bands stay within the minimap's below-axis space.
  const chapterRows = React.useMemo(() => {
    if (!chapters.length) return []
    const sorted = [...chapters].sort((a, b) => new Date(a.start) - new Date(b.start))
    const rowEnds = []
    return sorted.map(ch => {
      const s = new Date(ch.start).getTime()
      const e = ch.end ? new Date(ch.end).getTime() : todayMs
      let row = rowEnds.findIndex(end => end <= s)
      if (row === -1) row = rowEnds.length
      if (row >= MAX_ROWS) row = MAX_ROWS - 1  // clamp overflow into last row
      rowEnds[row] = e
      return { ...ch, _row: row }
    })
  }, [chapters, todayMs])

  // Drag / click
  const drag = useRef({ active: false, startX: 0, startPan: 0, moved: false })

  function pointerDown(clientX) {
    drag.current = { active: true, startX: clientX, startPan: panMs, moved: false }
  }
  function pointerMove(clientX) {
    const d = drag.current
    if (!d.active) return
    if (Math.abs(clientX - d.startX) > 3) d.moved = true
    if (d.moved) onPanDirect(d.startPan + ((clientX - d.startX) / w) * mapSpan)
  }
  function pointerUp(clientX) {
    const d = drag.current
    if (!d.active) return
    d.active = false
    if (!d.moved) {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (rect) panToMs(xToMs(clientX - rect.left))
    }
  }

  return (
    <div
      ref={wrapRef}
      className="minimap-bar"
      onMouseDown={e => pointerDown(e.clientX)}
      onMouseMove={e => pointerMove(e.clientX)}
      onMouseUp={e => pointerUp(e.clientX)}
      onMouseLeave={() => { drag.current.active = false }}
      onTouchStart={e => pointerDown(e.touches[0].clientX)}
      onTouchMove={e => pointerMove(e.touches[0].clientX)}
      onTouchEnd={e => pointerUp(e.changedTouches[0].clientX)}
    >
      <svg width={w} height={H} style={{ display: 'block' }}>

        {/* Chapter bands — below the axis, stacked by row */}
        {chapterRows.map(ch => {
          const x1      = Math.max(0, msToX(new Date(ch.start).getTime()))
          const endMs_  = ch.end ? new Date(ch.end).getTime() : todayMs
          const x2      = Math.min(w, msToX(endMs_))
          if (x2 <= x1) return null
          const y = BAND_TOP + ch._row * (BAND_H + BAND_GAP)
          return (
            <rect key={ch.id}
              x={x1} y={y} width={x2 - x1} height={BAND_H}
              fill={ch.color} opacity={0.45} rx={1}
            />
          )
        })}

        {/* Axis */}
        <line x1={0} y1={H / 2} x2={w} y2={H / 2}
          stroke="rgba(var(--text-rgb), 0.07)" strokeWidth={1} />

        {/* Viewport rect */}
        {vx2 > vx1 && (
          <rect
            x={vx1} y={2} width={Math.max(2, vx2 - vx1)} height={H - 4}
            fill="rgba(var(--amber-rgb), 0.07)"
            stroke="var(--amber)" strokeWidth={1} strokeOpacity={0.28}
            rx={2}
          />
        )}

        {/* Milestone dots */}
        {milestones.map(m => {
          const x = msToX(new Date(m.date).getTime())
          if (x < -3 || x > w + 3) return null
          const isPast = new Date(m.date).getTime() < todayMs
          return (
            <circle key={m.id}
              cx={x} cy={H / 2}
              r={2.5}
              fill={m.color}
              opacity={isPast ? 0.5 : 0.85}
            />
          )
        })}

        {/* Today marker */}
        {todayX >= 0 && todayX <= w && (
          <line x1={todayX} y1={5} x2={todayX} y2={H - 5}
            stroke="var(--amber)" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.65} />
        )}

      </svg>
    </div>
  )
}
