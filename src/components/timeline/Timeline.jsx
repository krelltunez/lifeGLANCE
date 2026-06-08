import React, {
  useRef, useState, useEffect, useCallback,
  useImperativeHandle, forwardRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { dateToX, getTimeRangeForView, getTickMarks, assignLanes, getMsPerPx } from '../../utils/timeline'
import { relativeLabel, formatDateDisplay, ageAtDate } from '../../utils/dates'
import { dbGetMedia } from '../../data/db'

// Map text-size labels → root px value (must match TimelineView TEXT_SIZES)
const REM_PX = { small: 19, normal: 22, big: 26, bigger: 30 }

// ── Chapter helpers ───────────────────────────────────────────────────────────

// Greedy interval-graph colouring: assigns each chapter the lowest row index that
// doesn't conflict with an already-placed chapter in the same row.
function assignChapterRows(chapters) {
  const todayMs = Date.now()
  const sorted = [...chapters].sort((a, b) => new Date(a.start) - new Date(b.start))
  const rowEnds = [] // rowEnds[i] = end-time of the last chapter placed in row i
  return sorted.map(chapter => {
    const s = new Date(chapter.start).getTime()
    const e = chapter.end ? new Date(chapter.end).getTime() : todayMs
    let row = rowEnds.findIndex(end => end <= s)
    if (row === -1) { row = rowEnds.length; rowEnds.push(e) }
    else rowEnds[row] = e
    return { ...chapter, _row: row }
  })
}

// Human-readable elapsed duration, e.g. "3 yrs, 6 mo" or "8 mo".
// For ongoing chapters (endIso is null) uses today as the end.
function chapterSpan(startIso, endIso) {
  const s = new Date(startIso), e = endIso ? new Date(endIso) : new Date()
  const totalMonths = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth())
  const yrs = Math.floor(totalMonths / 12)
  const mos = totalMonths % 12
  if (yrs > 0 && mos > 0) return `${yrs} yr${yrs !== 1 ? 's' : ''}, ${mos} mo`
  if (yrs > 0)             return `${yrs} yr${yrs !== 1 ? 's' : ''}`
  if (mos > 0)             return `${mos} mo`
  return '< 1 mo'
}

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
  { milestones, chapters = [], zoom, textSize = 'normal', onMilestoneClick, onChapterClick, onChapterDoubleClick, customHalfMs = 0, highlightedIds, panMs, onPanMs, viewMode = 'all', onClusterClick, clustering = true, birthday = '', newlyAddedId = null, ultraCompact = false },
  ref
) {
  const { t } = useTranslation('timeline')
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
  const [compactLayout, setCompactLayout] = useState(
    () => window.matchMedia('(max-height: 900px)').matches
  )
  const [photoTip,    setPhotoTip]    = useState(null) // { uri, x, y }
  const [chapterTip,  setChapterTip]  = useState(null) // { chapter, x, y } | null
  const [playingId,   setPlayingId]   = useState(null)
  const audioElRef = useRef(null)
  // Track which IDs have already played their fly-in so we don't re-animate on re-renders
  const [flyDoneIds,  setFlyDoneIds]  = useState(() => new Set())
  // panMsRef always tracks the latest value for animation calculations
  const panMsRef        = useRef(panMs)
  const animRef         = useRef(null)
  const drag            = useRef({ active: false, startX: 0, startPan: 0 })
  // Distinguishes single-click (drill-in) from double-click (edit) on chapter ribbons.
  const chapterClickTimer = useRef(null)

  // Track viewport height for compact layout (axis shift + all-above)
  useEffect(() => {
    const mq = window.matchMedia('(max-height: 900px)')
    const handler = (e) => setCompactLayout(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

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

  // Audio playback — stop and revoke object URL on unmount
  useEffect(() => {
    return () => {
      if (audioElRef.current) {
        audioElRef.current.pause()
        if (audioElRef.current._objectUrl) URL.revokeObjectURL(audioElRef.current._objectUrl)
        audioElRef.current = null
      }
    }
  }, [])

  function handleAudioClick(m) {
    // Stop whatever is currently playing
    if (audioElRef.current) {
      audioElRef.current.pause()
      if (audioElRef.current._objectUrl) URL.revokeObjectURL(audioElRef.current._objectUrl)
      audioElRef.current = null
      if (playingId === m.id) { setPlayingId(null); return }
    }
    // Fetch blob lazily and play via a transient object URL
    dbGetMedia(m.id).then(result => {
      if (!result) return
      const url = URL.createObjectURL(result.blob)
      const a = new Audio(url)
      a._objectUrl = url
      audioElRef.current = a
      setPlayingId(m.id)
      a.play().catch(() => {})
      a.onended = () => {
        URL.revokeObjectURL(url)
        audioElRef.current = null
        setPlayingId(null)
      }
    })
  }

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
  // ultraCompact + compactLayout (≤900px): axis pinned 40px from bottom so
  //   cards maximise space above and axis sits just above the minimap bar.
  //   Floor at 193 prevents card overflow at very small heights.
  // normal: axis centred.
  const axisY = compactLayout
    ? Math.max(193, h - 40)
    : Math.round(h * 0.50)

  // ── Chapter band: sits between milestones and the time axis ─────────────
  // CHAPTER_ROW_H scales with text size so the band feels proportional.
  const CHAPTER_ROW_H    = Math.round(remPx * 0.62)  // ~14px at normal (22px rem)
  const CHAPTER_ROW_GAP  = 2                           // px gap between stacked rows
  const CHAPTER_BAND_PAD = 4                           // top + bottom padding inside band

  const chaptersWithRows = assignChapterRows(chapters)
  const numChapterRows   = chaptersWithRows.length > 0
    ? Math.max(...chaptersWithRows.map(c => c._row)) + 1 : 0
  const chaptersBandH    = numChapterRows > 0
    ? CHAPTER_BAND_PAD + numChapterRows * CHAPTER_ROW_H + (numChapterRows - 1) * CHAPTER_ROW_GAP + CHAPTER_BAND_PAD
    : 0

  // Milestones (above-axis) connect to msAxisY; the chapter band fills [msAxisY, axisY].
  // Below-axis (future) milestones still connect to axisY directly.
  const msAxisY = axisY - chaptersBandH

  // ─────────────────────────────────────────────────────────────────────────

  const today    = new Date()
  const centerMs = today.getTime() + panMs
  const { startMs, endMs } = getTimeRangeForView(zoom, centerMs, viewMode, customHalfMs)
  const ticks    = getTickMarks(zoom, startMs, endMs, w)
  const todayX   = dateToX(today.getTime(), startMs, endMs, w)
  const msPerPx  = getMsPerPx(zoom, w, customHalfMs)
  const daysPerPx = msPerPx / 86400000
  // In compact mode: reserve 120px from the top for the today label, and
  // cluster milestones more aggressively to reduce card pile-up near today.
  const TOP_RESERVE        = compactLayout ? 120 : 16
  const CLUSTER_THRESHOLD  = CARD_W * (compactLayout ? 0.6 : 0.4)
  const maxLane  = Math.max(0, Math.floor((msAxisY - MAX_CONN - CARD_H2 - TOP_RESERVE) / CARD_STEP))

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

        {/* ── Chapter ribbon band ──────────────────────────────────────────── */}
        {chaptersBandH > 0 && (
          <g>
            {/* Subtle band background to give the band visual definition */}
            <rect x={0} y={msAxisY} width={w} height={chaptersBandH}
              fill="rgba(232,224,208,0.016)" />
            {/* Top separator: visual boundary between milestone cards and band */}
            <line x1={0} y1={msAxisY} x2={w} y2={msAxisY}
              stroke="rgba(232,224,208,0.08)" strokeWidth={1} />

            {/* Gradient defs for ongoing chapter fade-out past today */}
            <defs>
              {chaptersWithRows.filter(ch => !ch.end).map(ch => (
                <linearGradient
                  key={`fade-${ch.id}`}
                  id={`chapter-fade-${ch.id}`}
                  x1={todayX} y1={0}
                  x2={todayX + 50} y2={0}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor={ch.color} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={ch.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>

            {chaptersWithRows.map(chapter => {
              const chapterStartX = dateToX(new Date(chapter.start).getTime(), startMs, endMs, w)
              const isOngoing     = !chapter.end

              // For ongoing chapters the bar extends to todayX + fade width; for bounded, to chapterEndX.
              const chapterEndX = isOngoing
                ? todayX + 50
                : dateToX(new Date(chapter.end).getTime(), startMs, endMs, w)

              // Skip chapters that are entirely off-screen
              if (chapterEndX < -10 || chapterStartX > w + 10) return null
              // Skip ongoing chapters whose start date is still in the future (nothing has happened yet)
              if (isOngoing && chapterStartX > todayX + 5) return null

              const barY = msAxisY + CHAPTER_BAND_PAD + chapter._row * (CHAPTER_ROW_H + CHAPTER_ROW_GAP)
              const barH = CHAPTER_ROW_H

              // For ongoing: solid portion ends at todayX; fade portion starts there.
              const solidX1 = Math.max(0, chapterStartX)
              const solidX2 = isOngoing
                ? Math.min(w, Math.max(solidX1, todayX))
                : Math.min(w, chapterEndX)
              const solidW  = solidX2 - solidX1
              if (!isOngoing && solidW < 1) return null

              // Fade rect for ongoing chapters (visible only when today is on-screen)
              const fadeX1 = Math.max(0, todayX)
              const fadeX2 = Math.min(w, todayX + 50)
              const fadeW  = Math.max(0, fadeX2 - fadeX1)
              const showFade = isOngoing && todayX < w && fadeW > 0

              // Total visible width for label purposes
              const visX2  = showFade ? Math.max(solidX2, fadeX2) : solidX2
              const visW   = visX2 - solidX1

              // Label truncation: Courier Prime is monospace.
              // At 0.45em, char width ≈ remPx * 0.45 * 0.60 px
              const labelFontPx  = remPx * 0.45
              const labelCharW   = labelFontPx * 0.60
              const labelMaxCh   = Math.floor((visW - 14) / labelCharW)
              const durText      = chapterSpan(chapter.start, chapter.end)
              const fullLabel    = chapter.end
                ? `${chapter.title} · ${durText}`
                : `${chapter.title} · ${durText} · ${t('ongoing')}`
              const labelText    = labelMaxCh > 2
                ? (fullLabel.length <= labelMaxCh
                    ? fullLabel
                    : (chapter.title.length <= labelMaxCh ? chapter.title : chapter.title.slice(0, labelMaxCh - 1) + '…'))
                : ''

              const startYear = new Date(chapter.start).getFullYear()
              const endYear   = chapter.end ? new Date(chapter.end).getFullYear() : null

              return (
                <g key={chapter.id}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => setChapterTip({ chapter, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setChapterTip(null)}
                  onMouseMove={e => setChapterTip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                  onClick={() => {
                    // Clear any previous timer before setting a new one — a double-click
                    // fires onClick twice, and without this the first timer survives even
                    // after onDoubleClick clears the second one.
                    clearTimeout(chapterClickTimer.current)
                    chapterClickTimer.current = setTimeout(() => onChapterClick?.(chapter), 250)
                  }}
                  onDoubleClick={() => {
                    clearTimeout(chapterClickTimer.current)
                    onChapterDoubleClick?.(chapter)
                  }}
                >
                  {/* Solid bar body */}
                  {solidW > 0 && (
                    <rect x={solidX1} y={barY} width={solidW} height={barH}
                      fill={chapter.color} fillOpacity={0.18}
                      stroke={chapter.color} strokeOpacity={0.32} strokeWidth={0.5}
                      rx={2} />
                  )}

                  {/* Fade tail — ongoing chapters only, past the today marker */}
                  {showFade && (
                    <rect x={fadeX1} y={barY} width={fadeW} height={barH}
                      fill={`url(#chapter-fade-${chapter.id})`}
                      rx={2} />
                  )}

                  {/* Left-edge accent stripe — only when the chapter start is on-screen */}
                  {chapterStartX >= 0 && chapterStartX < w && (
                    <rect x={chapterStartX} y={barY} width={2} height={barH}
                      fill={chapter.color} opacity={0.85} rx={1} />
                  )}

                  {/* Title label — years zoom or closer, and bar at least 7% of viewport */}
                  {daysPerPx < 6.0 && visW >= w * 0.07 && labelText && (
                    <text
                      x={(solidX1 + Math.min(solidX2, w)) / 2}
                      textAnchor="middle"
                      y={barY + Math.round(barH * 0.73)}
                      fill={chapter.color}
                      fontSize="0.45em"
                      fontFamily="'Courier Prime', monospace"
                      opacity={0.9}
                    >{labelText}</text>
                  )}

                  {/* Start/end year markers — months zoom or closer, bar at least 45% of viewport */}
                  {daysPerPx < 0.8 && visW >= w * 0.45 && chapterStartX >= 4 && (
                    <text
                      x={chapterStartX + 4}
                      y={barY + barH - 2}
                      fill={chapter.color}
                      fontSize="0.38em"
                      fontFamily="'Courier Prime', monospace"
                      opacity={0.60}
                    >{startYear}</text>
                  )}
                  {!isOngoing && daysPerPx < 0.8 && visW >= w * 0.45 && chapterEndX <= w - 4 && (
                    <text
                      x={chapterEndX - 4}
                      y={barY + barH - 2}
                      textAnchor="end"
                      fill={chapter.color}
                      fontSize="0.38em"
                      fontFamily="'Courier Prime', monospace"
                      opacity={0.60}
                    >{endYear}</text>
                  )}
                </g>
              )
            })}
          </g>
        )}

        {/* ── Today marker ────────────────────────────────────────────────── */}
        {todayX > -10 && todayX < w + 10 && (() => {
          const tDay     = today.toLocaleDateString('en-US', { weekday: 'long'  }).toLowerCase()
          const tDate    = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }).toLowerCase()
          const tYear    = today.getFullYear()
          const centered = Math.abs(panMs) < 1
          const todayLocalDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
          const todayAge = birthday ? ageAtDate(birthday, todayLocalDate) : null
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
                opacity={centered ? 1 : 0.90}>{t('today')}</text>
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
                  opacity={centered ? 0.80 : 0.55}>{todayAge} {t('yearsOldSuffix')}</text>
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
            cardY  = msAxisY - connLen - m.lane * CARD_STEP - cardH
            cardY  = Math.max(84, cardY) // never overlap the today label (goes to ~y=68)
            connY1 = msAxisY - 4
            connY2 = cardY + cardH
          } else {
            cardY  = axisY + connLen + m.lane * CARD_STEP
            cardY  = Math.min(h - cardH - 10, cardY) // never clip below SVG bounds
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
          const groupStyle = isHL ? {
            transform: `translate(${cx}px,${cy}px) scale(1.06) translate(${-cx}px,${-cy}px)`,
            transition: 'transform 0.22s ease',
          } : {}

          // Fly-in for newly saved cards: scale from todayX so the card
          // appears to launch from today and travel to its date position.
          // Guard: fall back to standard if today is off-screen.
          const todayOnScreen = todayX >= 0 && todayX <= w
          const isFlying = m.id === newlyAddedId && !flyDoneIds.has(m.id) && todayOnScreen
          const flew     = flyDoneIds.has(m.id)
          const mAxisY = m.above ? msAxisY : axisY
          const innerAnimStyle = flew ? { animation: 'none' } : {
            animation:        isFlying
              ? 'milestone-fly 0.65s cubic-bezier(0.34,1.56,0.64,1) both'
              : 'milestone-appear 0.45s cubic-bezier(0.22,1,0.36,1) both',
            animationDelay:   isFlying ? '0ms' : `${i * 28}ms`,
            transformOrigin:  isFlying ? `${todayX}px ${mAxisY}px` : `${x}px ${mAxisY}px`,
          }
          // Stem fades in sync with the card but without scaling (it stays on the axis)
          const stemAnimStyle = flew ? {} : {
            animation:      isFlying
              ? 'milestone-stem-appear 0.3s ease both'
              : 'milestone-stem-appear 0.45s cubic-bezier(0.22,1,0.36,1) both',
            animationDelay: isFlying ? '0.35s' : `${i * 28}ms`,
          }

          return (
            <g key={m.id} onClick={() => onMilestoneClick(m)} opacity={alpha} style={{ cursor: 'pointer' }}>
              {/* Dot and connector: not inside the scale group so they stay on the axis */}
              <g style={stemAnimStyle}>
                <circle cx={x} cy={m.above ? msAxisY : axisY}
                  r={isHL ? 5.5 : 3.5}
                  fill={m.color}
                  opacity={isHL ? 1 : 0.85} />
                <line x1={x} y1={connY1} x2={x} y2={connY2}
                  stroke={m.color} strokeWidth={isHL ? 1.5 : 1} opacity={isHL ? 0.6 : 0.3} />
              </g>

              {/* Card content: scale on highlight, fly-in on first render */}
              <g style={groupStyle}>
              <g
                style={innerAnimStyle}
                onAnimationEnd={isFlying
                  ? () => setFlyDoneIds(prev => new Set([...prev, m.id]))
                  : undefined}
              >

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
                  >{age} {t('yearsOldSuffix')}</text>
                ) : null
              })()}

              {/* Card icons — top-right corner: camera, audio, link, recurrence (right → left) */}
              {(() => {
                const icons = []
                if (m.dayglance_linked) icons.push('dayglance')
                if (m.photo_uri)  icons.push('camera')
                if (m.media_type === 'audio') icons.push('audio')
                if (m.media_type === 'video') icons.push('video')
                if (m.url)        icons.push('link')
                if (m.recurrence) icons.push('recurrence')
                return icons.map((type, i) => {
                  const ix = cardX + CARD_W - 21 - i * 17
                  const iy = cardY + 3
                  const op = isHL ? 0.9 : 0.52
                  if (type === 'dayglance') return (
                    <text key="dayglance"
                      x={ix + 7} y={iy + 10}
                      fill={m.dayglance_completed ? '#34D399' : m.color}
                      fontSize="0.55em" fontFamily="'Courier Prime', monospace"
                      textAnchor="middle" opacity={isHL ? 0.9 : 0.7}
                    >{m.dayglance_completed ? '✓' : '◈'}</text>
                  )
                  if (type === 'camera') return (
                    <g key="camera" transform={`translate(${ix},${iy})`}
                       opacity={op} style={{ cursor: 'zoom-in' }}
                       onMouseEnter={e => setPhotoTip({ uri: m.photo_uri, x: e.clientX, y: e.clientY })}
                       onMouseLeave={() => setPhotoTip(null)}>
                      <rect x={-2} y={-1} width={18} height={13} fill="transparent" />
                      <rect x={0} y={2.5} width={14} height={8} rx={1.3}
                        fill="none" stroke={m.color} strokeWidth={0.85} />
                      <rect x={2} y={0.5} width={4} height={2.8} rx={0.7}
                        fill="none" stroke={m.color} strokeWidth={0.75} />
                      <circle cx={7} cy={6.5} r={2.6}
                        fill="none" stroke={m.color} strokeWidth={0.85} />
                      <circle cx={7} cy={6.5} r={1.25}
                        fill={m.color} opacity={0.55} />
                      <circle cx={11.8} cy={4} r={0.75} fill={m.color} />
                    </g>
                  )
                  if (type === 'audio') {
                    const isPlaying = playingId === m.id
                    return (
                      <g key="audio" transform={`translate(${ix},${iy})`}
                         opacity={isPlaying ? 1 : op} style={{ cursor: 'pointer' }}
                         onClick={e => { e.stopPropagation(); handleAudioClick(m) }}>
                        <rect x={-2} y={-1} width={18} height={13} fill="transparent" />
                        {/* Speaker body */}
                        <rect x={0.5} y={3.5} width={3.5} height={4} rx={0.4}
                          fill={isPlaying ? m.color : 'none'} stroke={m.color} strokeWidth={0.85} />
                        {/* Cone */}
                        <path d="M4,2 L7.5,0.5 L7.5,10.5 L4,9 Z"
                          fill={isPlaying ? m.color : 'none'} stroke={m.color} strokeWidth={0.85} strokeLinejoin="round" />
                        {/* Sound waves */}
                        <path d="M9,4 Q10.5,5.5 9,7"
                          fill="none" stroke={m.color} strokeWidth={0.85} strokeLinecap="round" />
                        <path d="M10.5,2.5 Q13,5.5 10.5,8.5"
                          fill="none" stroke={m.color} strokeWidth={0.85} strokeLinecap="round" />
                      </g>
                    )
                  }
                  if (type === 'video') return (
                    <g key="video" transform={`translate(${ix},${iy})`}
                       opacity={op} style={{ cursor: 'pointer' }}
                       onClick={e => { e.stopPropagation(); onMilestoneClick(m) }}>
                      <rect x={-2} y={-1} width={18} height={13} fill="transparent" />
                      {/* Video camera body */}
                      <rect x={0} y={2.5} width={8.5} height={6} rx={1.2}
                        fill="none" stroke={m.color} strokeWidth={0.85} />
                      {/* Viewfinder lens hint */}
                      <circle cx={4.25} cy={5.5} r={1.8}
                        fill="none" stroke={m.color} strokeWidth={0.75} />
                      {/* Camera triangle (recording head) */}
                      <path d="M8.5,4 L13,2.5 L13,8.5 L8.5,7 Z"
                        fill="none" stroke={m.color} strokeWidth={0.85} strokeLinejoin="round" />
                    </g>
                  )
                  if (type === 'link') return (
                    <g key="link" transform={`translate(${ix},${iy})`}
                       opacity={op} style={{ cursor: 'pointer' }}
                       onClick={e => { e.stopPropagation(); window.open(m.url, '_blank', 'noopener,noreferrer') }}>
                      <rect x={-2} y={-1} width={18} height={13} fill="transparent" />
                      {/* chain-link: two interlocked ovals */}
                      <rect x={0.5} y={3} width={7} height={5} rx={2.5}
                        fill="none" stroke={m.color} strokeWidth={0.9} />
                      <rect x={5.5} y={3} width={7} height={5} rx={2.5}
                        fill="none" stroke={m.color} strokeWidth={0.9} />
                    </g>
                  )
                  if (type === 'recurrence') return (
                    <g key="recurrence" transform={`translate(${ix},${iy})`} opacity={op}>
                      <rect x={-2} y={-1} width={18} height={13} fill="transparent" />
                      {/* top arc: CW from 210° to 330° (over the top), 30° gap each side */}
                      <path d="M 3.0,3.5 A 4,4 0 0,1 10.0,3.5"
                        fill="none" stroke={m.color} strokeWidth={0.9} strokeLinecap="round" />
                      {/* bottom arc: CW from 30° to 150° (under the bottom) */}
                      <path d="M 10.0,7.5 A 4,4 0 0,1 3.0,7.5"
                        fill="none" stroke={m.color} strokeWidth={0.9} strokeLinecap="round" />
                      {/* arrowhead at 3 o'clock — wings meet top arc endpoint at y=3.5 */}
                      <polyline points="9.5,3.5 10.5,5.5 11.5,3.5"
                        fill="none" stroke={m.color} strokeWidth={0.9}
                        strokeLinecap="round" strokeLinejoin="round" />
                      {/* arrowhead at 9 o'clock — wings meet bottom arc endpoint at y=7.5 */}
                      <polyline points="1.5,7.5 2.5,5.5 3.5,7.5"
                        fill="none" stroke={m.color} strokeWidth={0.9}
                        strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                  )
                  return null
                })
              })()}
              </g>
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
          const badgeCy = msAxisY - R - 10

          return (
            <g key={`cl-${idx}`} style={{ cursor: 'pointer' }}
               onClick={() => onClusterClick?.(clCenterMs)}>
              {/* Dashed connector */}
              <line x1={avgX} y1={msAxisY - 5} x2={avgX} y2={badgeCy + R}
                stroke="rgba(200,169,110,0.22)" strokeWidth={1} strokeDasharray="2 3" />
              {/* Axis dot */}
              <circle cx={avgX} cy={msAxisY} r={5}
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
              {/* Date range — above colour dots */}
              <text x={avgX} y={badgeCy - R - 17}
                textAnchor="middle"
                fill="rgba(232,224,208,0.55)"
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

      {chapterTip && (
        <div style={{
          position:      'fixed',
          left:          chapterTip.x,
          top:           chapterTip.y,
          transform:     'translate(-50%, calc(-100% - 10px))',
          pointerEvents: 'none',
          zIndex:        9999,
          background:    'rgba(13,15,22,0.95)',
          border:        `1px solid ${chapterTip.chapter.color}55`,
          borderLeft:    `2px solid ${chapterTip.chapter.color}`,
          padding:       '5px 9px',
          fontFamily:    "'Courier Prime', monospace",
          whiteSpace:    'nowrap',
        }}>
          <div style={{ fontSize: '0.65rem', color: chapterTip.chapter.color, fontWeight: 'bold' }}>
            {chapterTip.chapter.title}
          </div>
          <div style={{ fontSize: '0.55rem', color: 'rgba(232,224,208,0.55)', marginTop: 2 }}>
            {chapterSpan(chapterTip.chapter.start, chapterTip.chapter.end)}{!chapterTip.chapter.end && ` · ${t('ongoing')}`}
          </div>
        </div>
      )}
    </div>
  )
})

export default Timeline
