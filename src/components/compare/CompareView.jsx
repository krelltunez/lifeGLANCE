import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getTimeRangeForView, getTickMarks } from '../../utils/timeline'
import { formatDateDisplay } from '../../utils/dates'
import { makeCompareAxis, compareRows, agesAt, placeLabels, chapterLanes } from '../../utils/compare'
import { lifeName, lifeColor } from '../lives/lifeLabels'
import LifeAvatar from '../lives/LifeAvatar'

// Compare Lives (Lives v5.0, Phase 6a): one row per chosen Life on a shared,
// date-aligned axis. Read-only: nothing here edits; a milestone opens a
// read-only detail. Zoom, position and the category filter are the main
// timeline's, so switching between the two keeps your place.
// src/utils/compare.js has the rules; docs/lifeGLANCE-app-spec.md the decisions.

const AXIS_H    = 40     // tick labels and the today label
const LINE_Y    = 34     // the row line, from the row's top
const LANE_H    = 9
const LANE_GAP  = 3
const LANES_MAX = 3
const LABEL_CHARS = 18

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export default function CompareView({
  lives, selectedIds, onToggleLife, milestones, chapters, categoryFilter, birthDateOf,
  zoom, customHalfMs = 0, viewMode = 'all', panMs, onPanMs, onMilestoneClick, onClose,
}) {
  const { t, i18n } = useTranslation('lives')
  const { t: tt } = useTranslation('timeline')
  const wrapRef = useRef(null)
  const [w, setW] = useState(900)
  const [tip, setTip] = useState(null)   // { m, row, x, y, pinned }
  const drag = useRef(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const narrow = w < 640
  const labelW = narrow ? 44 : 150
  const plotW = w - labelW
  const today = new Date()
  const { startMs, endMs } = getTimeRangeForView(zoom, today.getTime() + panMs, viewMode, customHalfMs)
  const axis = makeCompareAxis({ startMs, endMs, width: plotW })
  const ticks = getTickMarks(zoom, startMs, endMs, plotW, i18n.language)
  const msPerPx = (endMs - startMs) / plotW

  const rows = useMemo(
    () => compareRows({ lives, selectedIds, milestones, chapters, categoryFilter, birthDateOf }),
    [lives, selectedIds, milestones, chapters, categoryFilter, birthDateOf],
  )
  const laid = rows.map(row => {
    const lanes = chapterLanes(row.chapters)
    const nLanes = Math.min(LANES_MAX, Math.max(0, ...lanes.map(l => l.lane + 1)))
    return { row, lanes, height: LINE_Y + 30 + nLanes * (LANE_H + LANE_GAP) + 8 }
  })
  let y = AXIS_H
  for (const r of laid) { r.top = y; y += r.height }
  const h = y + 8
  const todayX = axis.x(today.getTime(), null)

  // ── Pan by dragging (a drag never counts as a click) ──
  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return
    drag.current = { x: e.clientX, pan: panMs, moved: false }
  }
  function onPointerMove(e) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > 4) d.moved = true
    if (d.moved) onPanMs(d.pan - dx * msPerPx)
  }
  function onPointerUp() { setTimeout(() => { drag.current = null }, 0) }
  const wasDrag = () => drag.current?.moved

  // A tooltip sits below its dot, or above it when there is no room left in view.
  function openTip(m, row, x, y, pinned) {
    const el = wrapRef.current
    const above = !!el && y + 200 > el.scrollTop + el.clientHeight
    setTip({ m, row, x, y, pinned, above })
  }

  useEffect(() => {
    if (!tip?.pinned) return
    const close = (e) => { if (!e.target.closest?.('.compare-tip, .compare-dot')) setTip(null) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [tip])

  const ageLine = (a) => {
    const name = lifeName(a.row.life, t)
    if (a.state === 'age') return t('compareAge', { name, age: a.age })
    if (a.state === 'unborn') return t('compareUnborn', { name })
    if (a.state === 'dead') return t('compareAfterDeath', { name })
    return t('compareNoBirthDate', { name })
  }

  return (
    <div className="compare-view">
      <div className="compare-head">
        <span className="compare-title">{t('compareTitle')}</span>
        <div className="compare-chips" role="group" aria-label={t('compareChooseLives')}>
          {lives.map(l => {
            const on = selectedIds.includes(l.id)
            const last = on && selectedIds.length <= 2
            return (
              <button key={l.id} type="button" className={`compare-chip${on ? ' on' : ''}`}
                style={{ '--life-color': lifeColor(l) }} aria-pressed={on} disabled={last}
                title={last ? t('compareAtLeastTwo') : undefined} onClick={() => onToggleLife(l.id)}>
                <LifeAvatar life={l} size="1rem" />
                {lifeName(l, t)}
              </button>
            )
          })}
        </div>
        <span className="compare-note">{t('compareReadOnly')}</span>
        <button type="button" className="sheet-close" aria-label={t('compareClose')} onClick={onClose}>✕</button>
      </div>

      <div className="compare-body" ref={wrapRef}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="compare-svg">
          {/* Life names */}
          {laid.map(({ row, top }) => (
            <g key={`n-${row.life.id}`}>
              <foreignObject x={6} y={top + LINE_Y - 14} width={labelW - 10} height={28}>
                <div className="compare-name" style={{ '--life-color': lifeColor(row.life) }} title={lifeName(row.life, t)}>
                  <LifeAvatar life={row.life} size="1.2rem" />
                  {!narrow && <span>{lifeName(row.life, t)}</span>}
                </div>
              </foreignObject>
            </g>
          ))}

          <g transform={`translate(${labelW},0)`}>
            <defs>
              <clipPath id="compare-plot"><rect x={0} y={0} width={plotW} height={h} /></clipPath>
            </defs>
            <g clipPath="url(#compare-plot)">
              {/* Ticks and gridlines across every row */}
              {ticks.map((tick, i) => (
                <g key={i}>
                  <line x1={tick.x} x2={tick.x} y1={AXIS_H - 6} y2={h - 8}
                    stroke={tick.major ? 'rgba(var(--text-rgb), 0.08)' : 'rgba(var(--text-rgb), 0.04)'} />
                  {tick.label && (
                    <text x={tick.x} y={AXIS_H - 12} textAnchor="middle" fontSize="0.6em"
                      fill={tick.major ? 'rgba(var(--text-rgb), 0.4)' : 'rgba(var(--text-rgb), 0.22)'}
                      fontFamily="'Courier Prime', monospace">{tick.label}</text>
                  )}
                </g>
              ))}

              {laid.map(({ row, lanes, top }) => {
                const color = lifeColor(row.life)
                const lineY = top + LINE_Y
                const x0 = row.fromMs != null ? axis.x(row.fromMs, row) : null
                const x1 = axis.x(row.toMs, row)
                const dots = row.milestones.map(m => ({ m, x: axis.x(new Date(m.date).getTime(), row) }))
                  // Only dots inside the plot: one clipped at the edge would still be
                  // focusable and tappable under the names column.
                  .filter(d => d.x >= -4 && d.x <= plotW + 4)
                const labels = placeLabels(dots.map(d => ({ id: d.m.id, x: d.x })), LABEL_CHARS * 6.4)
                return (
                  <g key={row.life.id} className="compare-row">
                    <line x1={0} x2={plotW} y1={top + 0.5} y2={top + 0.5} stroke="rgba(var(--text-rgb), 0.06)" />
                    {x0 != null && x1 > x0 && (
                      <line x1={Math.max(-2, x0)} x2={Math.min(plotW + 2, x1)} y1={lineY} y2={lineY}
                        stroke={color} strokeWidth={2} strokeOpacity={0.55} />
                    )}
                    {row.ended && x1 >= 0 && x1 <= plotW && (
                      <line x1={x1} x2={x1} y1={lineY - 7} y2={lineY + 7} stroke={color} strokeWidth={2} strokeOpacity={0.8} />
                    )}
                    {row.fromMs == null && row.milestones.length === 0 && (
                      <text x={8} y={lineY + 4} fontSize="0.6em" fill="rgba(var(--text-rgb), 0.35)"
                        fontFamily="'Courier Prime', monospace">{t('compareEmptyRow')}</text>
                    )}

                    {/* Chapters, below the line */}
                    {lanes.filter(l => l.lane < LANES_MAX).map(({ chapter, lane }) => {
                      const cx0 = axis.x(new Date(chapter.start).getTime(), row)
                      const cx1 = axis.x(chapter.end ? new Date(chapter.end).getTime() : today.getTime(), row)
                      if (cx1 < 0 || cx0 > plotW) return null
                      const cy = lineY + 28 + lane * (LANE_H + LANE_GAP)
                      const bx = Math.max(0, cx0), bw = Math.max(2, Math.min(plotW, cx1) - bx)
                      return (
                        <g key={chapter.id}>
                          <rect x={bx} y={cy} width={bw} height={LANE_H} rx={2} fill={color} fillOpacity={0.3}>
                            <title>{chapter.title}</title>
                          </rect>
                          {bw > 50 && (
                            <text x={bx + 4} y={cy + LANE_H - 2} fontSize="0.5em" fill="var(--text)"
                              fontFamily="'Courier Prime', monospace" pointerEvents="none">
                              {truncate(chapter.title, Math.floor((bw - 8) / 5.2))}
                            </text>
                          )}
                        </g>
                      )
                    })}

                    {/* Milestones on the line */}
                    {dots.map(({ m, x }) => {
                      const side = labels.get(m.id)
                      const after = row.deathDate && String(m.date).slice(0, 10) > row.deathDate
                      return (
                        <g key={m.id} className="compare-dot" tabIndex={0} role="button"
                          aria-label={`${m.title}, ${formatDateDisplay(m.date, m.date_precision, i18n.language)}`}
                          onPointerEnter={(e) => { if (e.pointerType === 'mouse' && !tip?.pinned) openTip(m, row, x + labelW, lineY, false) }}
                          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setTip(cur => (cur?.pinned ? cur : null)) }}
                          onFocus={() => openTip(m, row, x + labelW, lineY, false)}
                          onBlur={() => setTip(cur => (cur?.pinned ? cur : null))}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMilestoneClick(m, row.life) } }}
                          onClick={(e) => {
                            if (wasDrag()) return
                            // Touch: the first tap shows the ages; the tip opens the detail.
                            if (e.nativeEvent.pointerType && e.nativeEvent.pointerType !== 'mouse') {
                              openTip(m, row, x + labelW, lineY, true)
                              return
                            }
                            onMilestoneClick(m, row.life)
                          }}>
                          <circle cx={x} cy={lineY} r={11} fill="transparent" />
                          <circle cx={x} cy={lineY} r={4.5} fill={color} fillOpacity={after ? 0.5 : 1}
                            stroke="var(--bg)" strokeWidth={1.5} />
                          {side && (
                            <text x={x - 4} y={side === 'above' ? lineY - 10 : lineY + 18} fontSize="0.58em"
                              fill="rgba(var(--text-rgb), 0.78)" fontFamily="'Courier Prime', monospace" pointerEvents="none">
                              {truncate(m.title, LABEL_CHARS)}
                            </text>
                          )}
                        </g>
                      )
                    })}
                  </g>
                )
              })}

              {/* Today, across every row */}
              {todayX > -10 && todayX < plotW + 10 && (
                <g pointerEvents="none">
                  <line x1={todayX} x2={todayX} y1={AXIS_H - 4} y2={h - 8} stroke="var(--amber)" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.8} />
                  <text x={todayX} y={12} textAnchor="middle" fontSize="0.6em" fill="var(--amber)"
                    fontFamily="'Courier Prime', monospace">{tt('today')}</text>
                </g>
              )}
            </g>
          </g>
        </svg>

        {tip && (
          <div className={`compare-tip${tip.pinned ? ' pinned' : ''}`}
            style={{ left: Math.min(Math.max(8, tip.x - 110), w - 236), top: tip.above ? tip.y - 14 : tip.y + 14,
              transform: tip.above ? 'translateY(-100%)' : undefined }}>
            <div className="compare-tip-title">{tip.m.title}</div>
            <div className="compare-tip-date">{formatDateDisplay(tip.m.date, tip.m.date_precision, i18n.language)}</div>
            <ul className="compare-tip-ages">
              {agesAt(tip.m.date, rows).map(a => <li key={a.row.life.id} style={{ '--life-color': lifeColor(a.row.life) }}>{ageLine(a)}</li>)}
            </ul>
            {tip.pinned && (
              <button type="button" className="btn" style={{ fontSize: '0.7rem', padding: '0.3rem 0.7rem' }}
                onClick={() => { const { m, row } = tip; setTip(null); onMilestoneClick(m, row.life) }}>
                {t('compareOpenDetail')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
