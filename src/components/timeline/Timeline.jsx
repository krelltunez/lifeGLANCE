import React, {
  useRef, useState, useEffect, useCallback,
  useImperativeHandle, forwardRef,
} from 'react'
import { dateToX, getTimeRange, getTickMarks, assignLanes, getMsPerPx } from '../../utils/timeline'
import { relativeLabel, formatDateDisplay } from '../../utils/dates'

// Map text-size labels → root px value (must match TimelineView TEXT_SIZES)
const REM_PX = { small: 19, normal: 22, big: 26, bigger: 30 }

const Timeline = forwardRef(function Timeline({ milestones, zoom, textSize = 'normal', onMilestoneClick }, ref) {
  // All card geometry derived from the current rem size so cards scale with text
  const remPx    = REM_PX[textSize] || 22
  const CARD_W   = Math.round(remPx * 7.8)   // wide enough for ~17 monospace chars at 0.6em
  const CARD_H   = Math.round(remPx * 3.2)   // tall enough for 3 lines
  const CONN_LEN = Math.round(remPx * 0.9)   // connector gap from axis to card edge
  const CARD_STEP = CARD_H + Math.round(remPx * 0.55)  // lane-to-lane distance
  // Text baselines as fractions of card height
  const LINE1 = Math.round(CARD_H * 0.33)
  const LINE2 = Math.round(CARD_H * 0.61)
  const LINE3 = Math.round(CARD_H * 0.87)
  const wrapRef = useRef(null)
  const [size, setSize] = useState({ w: 800, h: 340 })
  const [panMs, setPanMs] = useState(0)
  const drag = useRef({ active: false, startX: 0, startPan: 0 })

  useImperativeHandle(ref, () => ({ resetPan: () => setPanMs(0) }))

  // Measure container
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const { w, h } = size
  const axisY     = Math.round(h * 0.5)
  const today     = new Date()
  const centerMs  = today.getTime() + panMs
  const { startMs, endMs } = getTimeRange(zoom, centerMs)
  const ticks     = getTickMarks(zoom, startMs, endMs, w)
  const todayX    = dateToX(today.getTime(), startMs, endMs, w)
  const withLanes = assignLanes(milestones)
  const msPerPx   = getMsPerPx(zoom, w)

  // ── Pan ─────────────────────────────────────────────────────────────────────
  const startDrag = useCallback((clientX) => {
    drag.current = { active: true, startX: clientX, startPan: panMs }
  }, [panMs])

  const moveDrag = useCallback((clientX) => {
    if (!drag.current.active) return
    const dx = clientX - drag.current.startX
    setPanMs(drag.current.startPan - dx * msPerPx)
  }, [msPerPx])

  const endDrag = useCallback(() => { drag.current.active = false }, [])

  const touchId = useRef(null)

  return (
    <div
      ref={wrapRef}
      className="timeline-svg-wrap"
      style={{ flex: 1 }}
      onMouseDown={e => startDrag(e.clientX)}
      onMouseMove={e => moveDrag(e.clientX)}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onTouchStart={e => {
        const t = e.touches[0]
        touchId.current = t.identifier
        startDrag(t.clientX)
      }}
      onTouchMove={e => {
        const t = [...e.touches].find(x => x.identifier === touchId.current)
        if (t) moveDrag(t.clientX)
      }}
      onTouchEnd={endDrag}
    >
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: 'block', fontSize: '1rem', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="tl-left" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#0F1117" stopOpacity="1" />
            <stop offset="1" stopColor="#0F1117" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="tl-right" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#0F1117" stopOpacity="0" />
            <stop offset="1" stopColor="#0F1117" stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* ── Tick marks ──────────────────────────────────────────────────── */}
        {ticks.map((tick, i) => (
          <g key={i}>
            <line
              x1={tick.x} y1={axisY - (tick.major ? 7 : 3)}
              x2={tick.x} y2={axisY + (tick.major ? 7 : 3)}
              stroke={tick.major ? 'rgba(232,224,208,0.25)' : 'rgba(232,224,208,0.1)'}
              strokeWidth={1}
            />
            {tick.label && (
              <text
                x={tick.x} y={axisY + 20}
                textAnchor="middle"
                fill={tick.major ? 'rgba(232,224,208,0.35)' : 'rgba(232,224,208,0.18)'}
                fontSize={tick.major ? '0.69em' : '0.56em'}
                fontFamily="'Courier Prime', monospace"
              >
                {tick.label}
              </text>
            )}
          </g>
        ))}

        {/* ── Axis line ───────────────────────────────────────────────────── */}
        <line
          x1={0} y1={axisY} x2={w} y2={axisY}
          stroke="rgba(232,224,208,0.18)" strokeWidth={1}
        />

        {/* ── Today marker ────────────────────────────────────────────────── */}
        {todayX > -10 && todayX < w + 10 && (
          <g>
            <line
              x1={todayX} y1={22}
              x2={todayX} y2={h - 22}
              stroke="#C8A96E" strokeWidth={1.5}
              strokeDasharray="4 4" opacity={0.75}
            />
            <text
              x={todayX} y={16}
              textAnchor="middle"
              fill="#C8A96E" fontSize="0.56em"
              fontFamily="'Courier Prime', monospace"
              opacity={0.75}
            >
              today
            </text>
          </g>
        )}

        {/* ── Milestone cards ─────────────────────────────────────────────── */}
        {withLanes.map((m) => {
          const x = dateToX(new Date(m.date).getTime(), startMs, endMs, w)
          if (x < -(CARD_W + 10) || x > w + CARD_W + 10) return null

          const isPast = new Date(m.date) < today
          const alpha  = isPast ? 0.72 : 1

          // Card y position — stacked outward from axis per lane
          let cardY, connY1, connY2
          if (m.above) {
            cardY  = axisY - CONN_LEN - m.lane * CARD_STEP - CARD_H
            connY1 = axisY - 4
            connY2 = cardY + CARD_H
          } else {
            cardY  = axisY + CONN_LEN + m.lane * CARD_STEP
            connY1 = axisY + 4
            connY2 = cardY
          }

          // Clamp card horizontally so it doesn't overflow SVG edges
          const cardX = Math.max(4, Math.min(x - CARD_W / 2, w - CARD_W - 4))

          // Text content
          const title   = m.title.length > 17 ? m.title.slice(0, 17) + '…' : m.title
          const dateStr = formatDateDisplay(m.date, m.date_precision)
          const relStr  = relativeLabel(m.date, m.date_precision)

          const borderOpacity = isPast ? 0.35 : 0.65

          return (
            <g
              key={m.id}
              onClick={() => onMilestoneClick(m)}
              style={{ cursor: 'pointer' }}
              opacity={alpha}
            >
              {/* Axis anchor dot */}
              <circle cx={x} cy={axisY} r={3.5} fill={m.color} opacity={0.85} />

              {/* Connector line */}
              <line
                x1={x} y1={connY1}
                x2={x} y2={connY2}
                stroke={m.color} strokeWidth={1} opacity={0.3}
              />

              {/* Card body */}
              <rect
                x={cardX} y={cardY}
                width={CARD_W} height={CARD_H}
                fill="rgba(13,15,22,0.96)"
                stroke={m.color}
                strokeOpacity={borderOpacity}
                strokeWidth={1}
                style={{
                  animation: 'milestone-appear 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
                  transformOrigin: `${x}px ${axisY}px`,
                }}
              />

              {/* Left accent bar */}
              <rect
                x={cardX} y={cardY}
                width={3} height={CARD_H}
                fill={m.color}
                opacity={isPast ? 0.5 : 0.85}
              />

              {/* Title */}
              <text
                x={cardX + 10} y={cardY + LINE1}
                fill="rgba(232,224,208,0.95)"
                fontSize="0.6em"
                fontFamily="'Courier Prime', monospace"
                fontWeight="bold"
              >
                {title}
              </text>

              {/* Date */}
              <text
                x={cardX + 10} y={cardY + LINE2}
                fill="rgba(232,224,208,0.45)"
                fontSize="0.52em"
                fontFamily="'Courier Prime', monospace"
              >
                {dateStr}
              </text>

              {/* Relative time */}
              <text
                x={cardX + 10} y={cardY + LINE3}
                fill="#C8A96E"
                fontSize="0.52em"
                fontFamily="'Courier Prime', monospace"
              >
                {relStr}
              </text>
            </g>
          )
        })}

        {/* ── Edge fades ───────────────────────────────────────────────────── */}
        <rect x={0}    y={0} width={70} height={h} fill="url(#tl-left)"  pointerEvents="none" />
        <rect x={w-70} y={0} width={70} height={h} fill="url(#tl-right)" pointerEvents="none" />
      </svg>
    </div>
  )
})

export default Timeline
