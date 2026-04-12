import React, { useMemo } from 'react'
import { formatDateDisplay } from '../../utils/dates'

function formatSpan(ms) {
  const days   = ms / (24 * 3600 * 1000)
  const years  = Math.floor(days / 365.25)
  const months = Math.floor((days % 365.25) / 30.4)
  if (years > 0 && months > 0) return `${years} yr${years !== 1 ? 's' : ''}, ${months} mo`
  if (years > 0)               return `${years} yr${years !== 1 ? 's' : ''}`
  if (months > 0)              return `${months} mo`
  return `${Math.round(days)} day${Math.round(days) !== 1 ? 's' : ''}`
}

export default function SummaryModal({ milestones, onClose }) {
  const stats = useMemo(() => {
    if (!milestones.length) return null

    const today   = new Date()
    // Exclude recurring duplicates from analytical stats — keep only one per recurrence_id
    const deduped = milestones.filter((m, _, arr) =>
      !m.recurrence_id || arr.findIndex(x => x.recurrence_id === m.recurrence_id) === arr.indexOf(m)
    )
    const sorted  = [...deduped].sort((a, b) => new Date(a.date) - new Date(b.date))

    const past   = milestones.filter(m => new Date(m.date) < today).length
    const future = milestones.filter(m => new Date(m.date) >= today).length

    // Span from earliest to latest (including recurring)
    const allSorted = [...milestones].sort((a, b) => new Date(a.date) - new Date(b.date))
    const spanMs = allSorted.length > 1
      ? new Date(allSorted.at(-1).date) - new Date(allSorted[0].date)
      : 0

    // Longest gap between consecutive deduplicated milestones
    let longestGap = 0, gapA = null, gapB = null
    for (let i = 1; i < sorted.length; i++) {
      const gap = new Date(sorted[i].date) - new Date(sorted[i - 1].date)
      if (gap > longestGap) { longestGap = gap; gapA = sorted[i - 1]; gapB = sorted[i] }
    }

    // Busiest year (deduped)
    const byYear = {}
    for (const m of deduped) {
      const y = new Date(m.date).getFullYear()
      byYear[y] = (byYear[y] || 0) + 1
    }
    const busiestEntry = Object.entries(byYear).sort((a, b) => b[1] - a[1])[0]

    // Decade breakdown (deduped)
    const byDecade = {}
    for (const m of deduped) {
      const dec = Math.floor(new Date(m.date).getFullYear() / 10) * 10
      byDecade[dec] = (byDecade[dec] || 0) + 1
    }
    const decades      = Object.entries(byDecade).sort((a, b) => Number(a[0]) - Number(b[0]))
    const maxDecCount  = Math.max(...decades.map(d => d[1]), 1)

    return { total: milestones.length, past, future, spanMs, longestGap, gapA, gapB, busiestEntry, decades, maxDecCount }
  }, [milestones])

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-header">
          <span className="sheet-title">timeline stats</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {!stats ? (
          <div className="settings-note">no milestones yet</div>
        ) : (
          <>
            {/* Overview grid */}
            <div className="summary-grid">
              <div className="summary-cell">
                <div className="summary-value">{stats.total}</div>
                <div className="summary-label">milestones</div>
              </div>
              <div className="summary-cell">
                <div className="summary-value">{stats.past}</div>
                <div className="summary-label">in the past</div>
              </div>
              <div className="summary-cell">
                <div className="summary-value">{stats.future}</div>
                <div className="summary-label">upcoming</div>
              </div>
              <div className="summary-cell">
                <div className="summary-value">{stats.spanMs > 0 ? formatSpan(stats.spanMs) : '—'}</div>
                <div className="summary-label">time tracked</div>
              </div>
            </div>

            {/* Longest gap */}
            {stats.gapA && stats.gapB && (
              <div className="summary-section">
                <div className="summary-section-label">longest gap</div>
                <div className="summary-gap">
                  <span className="summary-gap-title">{stats.gapA.title}</span>
                  <span className="summary-gap-arrow">→</span>
                  <span className="summary-gap-title">{stats.gapB.title}</span>
                </div>
                <div className="summary-gap-dur">{formatSpan(stats.longestGap)}</div>
              </div>
            )}

            {/* Busiest year */}
            {stats.busiestEntry && (
              <div className="summary-section">
                <div className="summary-section-label">busiest year</div>
                <div className="summary-busiest">
                  <span className="summary-busiest-year">{stats.busiestEntry[0]}</span>
                  <span className="summary-busiest-count">
                    {stats.busiestEntry[1]} milestone{stats.busiestEntry[1] !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            )}

            {/* Decade breakdown */}
            {stats.decades.length > 0 && (
              <div className="summary-section">
                <div className="summary-section-label">by decade</div>
                <div className="summary-decades">
                  {stats.decades.map(([dec, count]) => (
                    <div key={dec} className="summary-decade-row">
                      <div className="summary-decade-label">{dec}s</div>
                      <div className="summary-decade-track">
                        <div className="summary-decade-bar"
                          style={{ width: `${(count / stats.maxDecCount) * 100}%` }} />
                      </div>
                      <div className="summary-decade-count">{count}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
