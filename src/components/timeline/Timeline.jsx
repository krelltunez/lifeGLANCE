import React, {
  useRef, useState, useEffect, useCallback,
  useImperativeHandle, forwardRef,
} from 'react'
import { dateToX, getTimeRange, getTickMarks, assignLanes, getMsPerPx } from '../../utils/timeline'
import { relativeLabel, formatDateDisplay } from '../../utils/dates'

// Map text-size labels → root px value (must match TimelineView TEXT_SIZES)
const REM_PX = { small: 19, normal: 22, big: 26, bigger: 30 }

// Word-wrap title to at most 2 lines given a max-chars-per-line limit.
// Courier Prime is monospace so char-count is a reliable width proxy.
function wrapTitle(text, maxChars) {
  if (text.length <= maxChars) return [text]

  // Walk words, filling line 1 then line 2
  const words = text.split(' ')
  let line1 = '', line2 = ''

  for (const word of words) {
    const candidate = line1 ? line1 + ' ' + word : word
    if (!line1 || candidate.length <= maxChars) {
      line1 = candidate
    } else if (!line2) {
      // Start line 2
      line2 = word.length > maxChars ? word.slice(0, maxChars - 1) + '…' : word
    } else {
      const c2 = line2 + ' ' + word
      if (c2.length <= maxChars) {
        line2 = c2
      } else {
        // Truncate remainder onto line 2
        if (line2.length < maxChars - 1) line2 = line2 + ' ' + word.slice(0, maxChars - line2.length - 2) + '…'
        break
      }
    }
  }

  return line2 ? [line1, line2] : [line1]
}

const Timeline = forwardRef(function Timeline({ milestones, zoom, textSize = 'normal', onMilestoneClick }, ref) {
  // All card geometry derived from the current rem size so cards scale with text
  const remPx = REM_PX[textSize] || 22

  // Card width — wide enough for ~17 Courier Prime chars at 0.6em
  const CARD_W       = Math.round(remPx * 7.8)
  // Title chars per line: available px / (0.6em * ~0.6 char-width ratio)
  const TITLE_CHARS  = Math.floor((CARD_W - 20) / (remPx * 0.6 * 0.6))
  // Connector gap from axis to nearest card edge
  const CONN_LEN     = Math.round(remPx * 0.9)
  // Vertical spacing constants (in SVG user-units = CSS px since viewBox matches)
  const TOP_PAD      = Math.round(remPx * 0.65)   // top of card → first baseline
  const TITLE_LH     = Math.round(remPx * 0.90)   // title line-to-line spacing
  const SEC_GAP      = Math.round(remPx * 0.45)   // gap between title block and meta
  const META_LH      = Math.round(remPx * 0.73)   // date / relative line spacing
  const BOT_PAD      = Math.round(remPx * 0.40)   // baseline → card bottom
  // Card heights for 1-line and 2-line titles
  const CARD_H1      = TOP_PAD + META_LH + SEC_GAP + META_LH + META_LH + BOT_PAD
  const CARD_H2      = TOP_PAD + META_LH + TITLE_LH + SEC_GAP + META_LH + META_LH + BOT_PAD
  // Lane step: always use the taller (2-line) card so lanes never overlap
  const CARD_STEP    = CARD_H2 + Math.round(remPx * 0.55)
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

          // Title wrap first — card height depends on number of lines
          const titleLines = wrapTitle(m.title, TITLE_CHARS)
          const cardH      = titleLines.length > 1 ? CARD_H2 : CARD_H1

          // Card y position — stacked outward from axis per lane
          let cardY, connY1, connY2
          if (m.above) {
            cardY  = axisY - CONN_LEN - m.lane * CARD_STEP - cardH
            connY1 = axisY - 4
            connY2 = cardY + cardH
          } else {
            cardY  = axisY + CONN_LEN + m.lane * CARD_STEP
            connY1 = axisY + 4
            connY2 = cardY
          }

          // Clamp card horizontally so it doesn't overflow SVG edges
          const cardX = Math.max(4, Math.min(x - CARD_W / 2, w - CARD_W - 4))

          const dateStr = formatDateDisplay(m.date, m.date_precision)
          const relStr  = relativeLabel(m.date, m.date_precision)
          const borderOpacity = isPast ? 0.35 : 0.65

          // Absolute text baseline y positions within the card
          const yT1   = cardY + TOP_PAD                                      // title line 1
          const yT2   = yT1 + TITLE_LH                                       // title line 2 (if any)
          const yMeta = (titleLines.length > 1 ? yT2 : yT1) + SEC_GAP + META_LH  // date
          const yRel  = yMeta + META_LH                                       // relative time

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
                width={CARD_W} height={cardH}
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
                width={3} height={cardH}
                fill={m.color}
                opacity={isPast ? 0.5 : 0.85}
              />

              {/* Title (1 or 2 lines) */}
              {titleLines.map((line, i) => (
                <text
                  key={i}
                  x={cardX + 10} y={i === 0 ? yT1 : yT2}
                  fill="rgba(232,224,208,0.95)"
                  fontSize="0.6em"
                  fontFamily="'Courier Prime', monospace"
                  fontWeight="bold"
                >
                  {line}
                </text>
              ))}

              {/* Date */}
              <text
                x={cardX + 10} y={yMeta}
                fill="rgba(232,224,208,0.45)"
                fontSize="0.52em"
                fontFamily="'Courier Prime', monospace"
              >
                {dateStr}
              </text>

              {/* Relative time */}
              <text
                x={cardX + 10} y={yRel}
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
