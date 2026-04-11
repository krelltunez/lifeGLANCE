import React, {
  useRef, useState, useEffect, useCallback,
  useImperativeHandle, forwardRef,
} from 'react'
import { dateToX, getTimeRangeForView, getTickMarks, assignLanes, getMsPerPx } from '../../utils/timeline'
import { relativeLabel, formatDateDisplay, ageAtDate } from '../../utils/dates'

// Map text-size labels → root px value (must match TimelineView TEXT_SIZES)
const REM_PX = { small: 19, normal: 22, big: 26, bigger: 30 }

// Word-wrap title to at most 2 lines given a max-chars-per-line limit.
// Courier Prime is monospace so char-count is a reliable width proxy.
function wrapTitle(text, maxChars) {
  if (text.length <= maxChars) return [text]
  const words = text.split(' ')
  let line1 = '', line2 = ''
  for (const word of words) {
    const candidate = line1 ? line1 + ' ' + word : word
    if (!line1 || candidate.length <= maxChars) {
      line1 = candidate
    } else if (!line2) {
      line2 = word.length > maxChars ? word.slice(0, maxChars - 1) + '…' : word
    } else {
      const c2 = line2 + ' ' + word
      if (c2.length <= maxChars) {
        line2 = c2
      } else {
        if (line2.length < maxChars - 1) line2 = line2 + ' ' + word.slice(0, maxChars - line2.length - 2) + '…'
        break
      }
    }
  }
  return line2 ? [line1, line2] : [line1]
}

const Timeline = forwardRef(function Timeline(
  { milestones, zoom, textSize = 'normal', onMilestoneClick, customHalfMs = 0, highlightedIds, panMs, onPanMs, viewMode = 'all', onClusterClick, clustering = true, birthday = '', newlyAddedId = null },
  ref
) {
  const remPx = REM_PX[textSize] || 22

  const CARD_W      = Math.round(remPx * 7.8)
  const TITLE_CHARS = Math.floor((CARD_W - 20) / (remPx * 0.6 * 0.6))
  const CONN_LEN    = Math.round(remPx * 1.8)
  const TOP_PAD     = Math.round(remPx * 0.65)
  const TITLE_LH    = Math.round(remPx * 0.90)
  const SEC_GAP     = Math.round(remPx * 0.45)
  const META_LH     = Math.round(remPx * 0.73)
  const BOT_PAD     = Math.round(remPx * 0.40)
  const CARD_H1     = TOP_PAD + META_LH + SEC_GAP + META_LH + META_LH + (birthday ? META_LH : 0) + BOT_PAD
  const CARD_H2     = TOP_PAD + META_LH + TITLE_LH + SEC_GAP + META_LH + META_LH + (birthday ? META_LH : 0) + BOT_PAD
  const CARD_STEP   = CARD_H2 + Math.round(remPx * 0.55)
  const MAX_CONN    = Math.round(CONN_LEN * 1.6)

  const wrapRef  = useRef(null)
  const [size, setSize] = useState({ w: 800, h: 340 })
  const [photoTip,    setPhotoTip]    = useState(null) // { uri, x, y }
  // Track which IDs have already played their fly-in so we don't re-animate on re-renders
  const [flyDoneIds,  setFlyDoneIds]  = useState(() => new Set())
  // panMsRef always tracks the latest value for animation calculations
  const panMsRef = useRef(panMs)
  const animRef  = useRef(null)
  const drag     = useRef({ active: false, startX: 0, startPan: 0 })

  // Keep ref in sync when panMs changes from parent (e.g. minimap direct scrub)
  useEffect(() => { panMsRef.current = panMs }, [panMs])

  // Shared smooth-pan helper
  const smoothPanTo = useCallback((targetPan) => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    const start = panMsRef.current
    const delta = targetPan - start
    if (Math.abs(delta) < 500) {
      panMsRef.current = targetPan
      onPanMs(targetPan)
      return
    }
    const t0 = performance.now()
    const dur = 480
    function tick(now) {
      const p = Math.min((now - t0) / dur, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      const val = start + delta * eased
      panMsRef.current = val
      onPanMs(val)
      if (p < 1) animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
  }, [onPanMs])

  // Expose imperative methods to parent
  useImperativeHandle(ref, () => ({
    resetPan: () => smoothPanTo(0),
    panToMs:  (targetMs) => smoothPanTo(targetMs - Date.now()),
  }), [smoothPanTo])

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
  const compactLayout = h < 700
  const axisY    = Math.round(h * (compactLayout ? 0.78 : 0.50))
  const today    = new Date()
  const centerMs = today.getTime() + panMs
  const { startMs, endMs } = getTimeRangeForView(zoom, centerMs, viewMode, customHalfMs)
  const ticks    = getTickMarks(zoom, startMs, endMs, w)
  const todayX   = dateToX(today.getTime(), startMs, endMs, w)
  const msPerPx  = getMsPerPx(zoom, w, customHalfMs)
  const maxLane  = Math.max(0, Math.floor((axisY - MAX_CONN - CARD_H2 - 16) / CARD_STEP))

  // ── Auto-density clustering ──────────────────────────────────────────────────
  // Milestones whose axis dots fall within CLUSTER_THRESHOLD px of each other
  // are collapsed into a badge instead of rendering as overlapping cards.
  const CLUSTER_THRESHOLD = CARD_W * 0.4

  const sorted = [...milestones].sort((a, b) => new Date(a.date) - new Date(b.date))
  const groups = []
  let gi = 0
  while (gi < sorted.length) {
    const group  = [sorted[gi]]
    const groupX = dateToX(new Date(sorted[gi].date).getTime(), startMs, endMs, w)
    let gj = gi + 1
    while (gj < sorted.length) {
      const xj = dateToX(new Date(sorted[gj].date).getTime(), startMs, endMs, w)
      if (xj - groupX < CLUSTER_THRESHOLD) { group.push(sorted[gj]); gj++ }
      else break
    }
    groups.push(group)
    gi += group.length
  }

  const singles       = clustering ? groups.filter(g => g.length === 1).map(g => g[0]) : milestones
  const clusterGroups = clustering ? groups.filter(g => g.length > 1) : []
  const withLanes     = assignLanes(singles, maxLane, msPerPx * CARD_W, compactLayout)

  // ── Pan ─────────────────────────────────────────────────────────────────────
  // startDrag reads panMsRef so it doesn't need panMs as a dep
  const startDrag = useCallback((clientX) => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    drag.current = { active: true, startX: clientX, startPan: panMsRef.current }
  }, [])

  const moveDrag = useCallback((clientX) => {
    if (!drag.current.active) return
    const val = drag.current.startPan - (clientX - drag.current.startX) * msPerPx
    panMsRef.current = val
    onPanMs(val)
  }, [msPerPx, onPanMs])

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
        width={w} height={h}
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
              >{tick.label}</text>
            )}
          </g>
        ))}

        {/* ── Axis line ───────────────────────────────────────────────────── */}
        <line x1={0} y1={axisY} x2={w} y2={axisY}
          stroke="rgba(232,224,208,0.18)" strokeWidth={1} />

        {/* ── Today marker ────────────────────────────────────────────────── */}
        {todayX > -10 && todayX < w + 10 && (() => {
          const tDay     = today.toLocaleDateString('en-US', { weekday: 'long'  }).toLowerCase()
          const tDate    = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }).toLowerCase()
          const tYear    = today.getFullYear()
          const centered = Math.abs(panMs) < 1
          const todayAge = birthday ? ageAtDate(birthday, today.toISOString().slice(0, 10)) : null
          const lineY1   = todayAge !== null ? 68 : 54
          return (
            <g style={{
              filter:     centered ? 'drop-shadow(0 0 6px #C8A96E) drop-shadow(0 0 14px #C8A96E55)' : 'none',
              transition: 'filter 0.35s ease',
            }}>
              <line x1={todayX} y1={lineY1} x2={todayX} y2={h - 14}
                stroke="#C8A96E" strokeWidth={centered ? 2 : 1.5} strokeDasharray="4 4"
                opacity={centered ? 1 : 0.75} />
              <text x={todayX} y={10} textAnchor="middle"
                fill="#C8A96E" fontSize="0.65em"
                fontFamily="'Courier Prime', monospace"
                opacity={centered ? 1 : 0.90}>today</text>
              <text x={todayX} y={22} textAnchor="middle"
                fill="#C8A96E" fontSize="0.60em"
                fontFamily="'Courier Prime', monospace"
                opacity={centered ? 1 : 0.70}>{tDay}</text>
              <text x={todayX} y={34} textAnchor="middle"
                fill="#C8A96E" fontSize="0.60em"
                fontFamily="'Courier Prime', monospace"
                opacity={centered ? 1 : 0.70}>{tDate}</text>
              <text x={todayX} y={47} textAnchor="middle"
                fill="#C8A96E" fontSize="0.65em" fontWeight="bold"
                fontFamily="'Courier Prime', monospace"
                opacity={centered ? 1 : 0.85}>{tYear}</text>
              {todayAge !== null && (
                <text x={todayX} y={61} textAnchor="middle"
                  fill="#C8A96E" fontSize="0.60em"
                  fontFamily="'Courier Prime', monospace"
                  opacity={centered ? 0.80 : 0.55}>{todayAge} y.o.</text>
              )}
            </g>
          )
        })()}

        {/* ── Milestone cards ─────────────────────────────────────────────── */}
        {withLanes.map((m, i) => {
          const x = dateToX(new Date(m.date).getTime(), startMs, endMs, w)
          if (x < -(CARD_W + 10) || x > w + CARD_W + 10) return null

          const isPast = new Date(m.date) < today
          const alpha  = isPast ? 0.72 : 1
          const isHL   = !!highlightedIds?.has(m.id)

          const connLen = CONN_LEN + Math.round((m.connRand ?? 0) * CONN_LEN * 0.6)

          const titleLines = wrapTitle(m.title, TITLE_CHARS)
          const cardH      = titleLines.length > 1 ? CARD_H2 : CARD_H1

          let cardY, connY1, connY2
          if (m.above) {
            cardY  = axisY - connLen - m.lane * CARD_STEP - cardH
            connY1 = axisY - 4
            connY2 = cardY + cardH
          } else {
            cardY  = axisY + connLen + m.lane * CARD_STEP
            connY1 = axisY + 4
            connY2 = cardY
          }

          const cardX = Math.max(4, Math.min(x - CARD_W / 2, w - CARD_W - 4))
          const dateStr = formatDateDisplay(m.date, m.date_precision)
          const relStr  = relativeLabel(m.date, m.date_precision)

          const borderOpacity = isHL ? 0.9 : (isPast ? 0.35 : 0.65)
          const borderWidth   = isHL ? 1.5 : 1

          const yT1   = cardY + TOP_PAD
          const yT2   = yT1 + TITLE_LH
          const yMeta = (titleLines.length > 1 ? yT2 : yT1) + SEC_GAP + META_LH
          const yRel  = yMeta + META_LH
          const yAge  = yRel + META_LH

          const cx = cardX + CARD_W / 2
          const cy = cardY + cardH / 2
          const groupStyle = {
            cursor: 'pointer',
            ...(isHL && {
              transform: `translate(${cx}px,${cy}px) scale(1.06) translate(${-cx}px,${-cy}px)`,
              transition: 'transform 0.22s ease',
            }),
          }

          // Fly-in for newly saved cards: scale from todayX so the card
          // appears to launch from today and travel to its date position.
          // Guard: fall back to standard if today is off-screen.
          const todayOnScreen = todayX >= 0 && todayX <= w
          const isFlying = m.id === newlyAddedId && !flyDoneIds.has(m.id) && todayOnScreen
          const flew     = flyDoneIds.has(m.id)
          const innerAnimStyle = flew ? { animation: 'none' } : {
            animation:        isFlying
              ? 'milestone-fly 0.65s cubic-bezier(0.34,1.56,0.64,1) both'
              : 'milestone-appear 0.45s cubic-bezier(0.22,1,0.36,1) both',
            animationDelay:   isFlying ? '0ms' : `${i * 28}ms`,
            transformOrigin:  isFlying ? `${todayX}px ${axisY}px` : `${x}px ${axisY}px`,
          }

          return (
            <g key={m.id} onClick={() => onMilestoneClick(m)} style={groupStyle} opacity={alpha}>
              <g
                style={innerAnimStyle}
                onAnimationEnd={isFlying
                  ? () => setFlyDoneIds(prev => new Set([...prev, m.id]))
                  : undefined}
              >
              <circle cx={x} cy={axisY}
                r={isHL ? 5.5 : 3.5}
                fill={m.color}
                opacity={isHL ? 1 : 0.85} />

              <line x1={x} y1={connY1} x2={x} y2={connY2}
                stroke={m.color} strokeWidth={isHL ? 1.5 : 1} opacity={isHL ? 0.6 : 0.3} />

              {isHL && (
                <rect x={cardX - 4} y={cardY - 4}
                  width={CARD_W + 8} height={cardH + 8}
                  fill={m.color} opacity={0.12} />
              )}

              <rect
                x={cardX} y={cardY}
                width={CARD_W} height={cardH}
                fill="rgba(13,15,22,0.96)"
                stroke={m.color}
                strokeOpacity={borderOpacity}
                strokeWidth={borderWidth}
                style={{
                  filter: isHL ? `drop-shadow(0 0 7px ${m.color}99)` : undefined,
                }}
              />

              <rect x={cardX} y={cardY} width={3} height={cardH}
                fill={m.color} opacity={isPast ? 0.5 : 0.85} />

              {titleLines.map((line, li) => (
                <text key={li}
                  x={cardX + 10} y={li === 0 ? yT1 : yT2}
                  fill="rgba(232,224,208,0.95)"
                  fontSize="0.6em" fontFamily="'Courier Prime', monospace" fontWeight="bold"
                >{line}</text>
              ))}

              <text x={cardX + 10} y={yMeta}
                fill="rgba(232,224,208,0.45)"
                fontSize="0.52em" fontFamily="'Courier Prime', monospace"
              >{dateStr}</text>

              <text x={cardX + 10} y={yRel}
                fill="#C8A96E"
                fontSize="0.52em" fontFamily="'Courier Prime', monospace"
              >{relStr}</text>

              {birthday && (() => {
                const age = ageAtDate(birthday, m.date)
                return age !== null ? (
                  <text x={cardX + 10} y={yAge}
                    fill="rgba(200,169,110,0.52)"
                    fontSize="0.52em" fontFamily="'Courier Prime', monospace"
                  >{age} y.o.</text>
                ) : null
              })()}

              {/* Vintage camera indicator — top-right corner */}
              {m.photo_uri && (
                <g transform={`translate(${cardX + CARD_W - 21},${cardY + 3})`}
                   opacity={isHL ? 0.9 : 0.52}
                   style={{ cursor: 'zoom-in' }}
                   onMouseEnter={e => setPhotoTip({ uri: m.photo_uri, x: e.clientX, y: e.clientY })}
                   onMouseLeave={() => setPhotoTip(null)}>
                  {/* invisible hit area for reliable hover */}
                  <rect x={-2} y={-1} width={18} height={13} fill="transparent" />
                  {/* body */}
                  <rect x={0} y={2.5} width={14} height={8} rx={1.3}
                    fill="none" stroke={m.color} strokeWidth={0.85} />
                  {/* viewfinder bump */}
                  <rect x={2} y={0.5} width={4} height={2.8} rx={0.7}
                    fill="none" stroke={m.color} strokeWidth={0.75} />
                  {/* lens ring */}
                  <circle cx={7} cy={6.5} r={2.6}
                    fill="none" stroke={m.color} strokeWidth={0.85} />
                  {/* lens glass */}
                  <circle cx={7} cy={6.5} r={1.25}
                    fill={m.color} opacity={0.55} />
                  {/* shutter button */}
                  <circle cx={11.8} cy={4} r={0.75}
                    fill={m.color} />
                </g>
              )}
              </g>
            </g>
          )
        })}

        {/* ── Cluster badges ──────────────────────────────────────────────── */}
        {clusterGroups.map((group, idx) => {
          const xs    = group.map(m => dateToX(new Date(m.date).getTime(), startMs, endMs, w))
          const avgX  = xs.reduce((a, b) => a + b, 0) / xs.length
          if (avgX < -40 || avgX > w + 40) return null

          const count     = group.length
          const colors    = [...new Map(group.map(m => [m.color, m.color])).values()].slice(0, 5)
          const years     = group.map(m => new Date(m.date).getFullYear())
          const minY      = Math.min(...years)
          const maxY      = Math.max(...years)
          const rangeLabel = minY === maxY ? String(minY) : `${minY}–${maxY}`
          const clCenterMs = group.reduce((s, m) => s + new Date(m.date).getTime(), 0) / count

          const R      = 11
          const badgeCy = axisY - R - 10

          return (
            <g key={`cl-${idx}`} style={{ cursor: 'pointer' }}
               onClick={() => onClusterClick?.(clCenterMs)}>
              {/* Dashed connector */}
              <line x1={avgX} y1={axisY - 5} x2={avgX} y2={badgeCy + R}
                stroke="rgba(200,169,110,0.22)" strokeWidth={1} strokeDasharray="2 3" />
              {/* Axis dot */}
              <circle cx={avgX} cy={axisY} r={5}
                fill="#0D0F16" stroke="rgba(200,169,110,0.55)" strokeWidth={1.2} />
              {/* Badge circle */}
              <circle cx={avgX} cy={badgeCy} r={R}
                fill="rgba(13,15,22,0.94)" stroke="rgba(200,169,110,0.4)" strokeWidth={1} />
              {/* Count */}
              <text x={avgX} y={badgeCy + 4}
                textAnchor="middle"
                fill="rgba(200,169,110,0.9)"
                fontSize="0.58em" fontFamily="'Courier Prime', monospace" fontWeight="bold"
              >{count}</text>
              {/* Category colour dots above badge */}
              {colors.map((color, ci) => {
                const spread = (colors.length - 1) * 6
                return (
                  <circle key={ci} cx={avgX + ci * 6 - spread / 2} cy={badgeCy - R - 6}
                    r={2.5} fill={color} opacity={0.82} />
                )
              })}
              {/* Date range */}
              <text x={avgX} y={axisY + 22}
                textAnchor="middle"
                fill="rgba(232,224,208,0.2)"
                fontSize="0.5em" fontFamily="'Courier Prime', monospace"
              >{rangeLabel}</text>
            </g>
          )
        })}

        {/* ── Edge fades ───────────────────────────────────────────────────── */}
        <rect x={0}    y={0} width={70}   height={h} fill="url(#tl-left)"  pointerEvents="none" />
        <rect x={w-70} y={0} width={70}   height={h} fill="url(#tl-right)" pointerEvents="none" />
      </svg>

      {photoTip && (
        <div style={{
          position: 'fixed',
          left: photoTip.x,
          top:  photoTip.y,
          transform: 'translate(-50%, calc(-100% - 12px))',
          pointerEvents: 'none',
          zIndex: 9999,
        }}>
          <img src={photoTip.uri} alt="" style={{
            display: 'block',
            maxWidth: 220,
            maxHeight: 180,
            objectFit: 'cover',
            borderRadius: 4,
            border: '1px solid rgba(200,169,110,0.35)',
            boxShadow: '0 6px 24px rgba(0,0,0,0.7)',
          }} />
        </div>
      )}
    </div>
  )
})

export default Timeline
