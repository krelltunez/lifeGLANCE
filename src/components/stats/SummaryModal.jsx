import React, { useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('stats')

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const stats = useMemo(() => {
    if (!milestones.length) return null

    const today = new Date()
    const seen = new Set()
    const deduped = [...milestones]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .filter(m => {
        if (!m.recurrence_id) return true
        if (seen.has(m.recurrence_id)) return false
        seen.add(m.recurrence_id)
        return true
      })
    const sorted = deduped

    const past   = deduped.filter(m => new Date(m.date) < today).length
    const future = deduped.filter(m => new Date(m.date) >= today).length

    const spanMs = deduped.length > 1
      ? new Date(deduped.at(-1).date) - new Date(deduped[0].date)
      : 0

    let longestGap = 0, gapA = null, gapB = null
    for (let i = 1; i < sorted.length; i++) {
      const gap = new Date(sorted[i].date) - new Date(sorted[i - 1].date)
      if (gap > longestGap) { longestGap = gap; gapA = sorted[i - 1]; gapB = sorted[i] }
    }

    const byYear = {}
    for (const m of deduped) {
      const y = new Date(m.date).getFullYear()
      byYear[y] = (byYear[y] || 0) + 1
    }
    const busiestEntry = Object.entries(byYear).sort((a, b) => b[1] - a[1])[0]

    const byDecade = {}
    for (const m of deduped) {
      const dec = Math.floor(new Date(m.date).getFullYear() / 10) * 10
      byDecade[dec] = (byDecade[dec] || 0) + 1
    }
    const decades      = Object.entries(byDecade).sort((a, b) => Number(a[0]) - Number(b[0]))
    const maxDecCount  = Math.max(...decades.map(d => d[1]), 1)

    return { total: deduped.length, past, future, spanMs, longestGap, gapA, gapB, busiestEntry, decades, maxDecCount }
  }, [milestones])

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-header">
          <span className="sheet-title">{t('title')}</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {!stats ? (
          <div className="settings-note">{t('noMilestones')}</div>
        ) : (
          <>
            {/* Overview grid */}
            <div className="summary-grid">
              <div className="summary-cell">
                <div className="summary-value">{stats.total}</div>
                <div className="summary-label">{t('milestones')}</div>
              </div>
              <div className="summary-cell">
                <div className="summary-value">{stats.past}</div>
                <div className="summary-label">{t('inThePast')}</div>
              </div>
              <div className="summary-cell">
                <div className="summary-value">{stats.future}</div>
                <div className="summary-label">{t('upcoming')}</div>
              </div>
              <div className="summary-cell">
                <div className="summary-value">{stats.spanMs > 0 ? formatSpan(stats.spanMs) : '—'}</div>
                <div className="summary-label">{t('timeTracked')}</div>
              </div>
            </div>

            {/* Longest gap */}
            {stats.gapA && stats.gapB && (
              <div className="summary-section">
                <div className="summary-section-label">{t('longestGap')}</div>
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
                <div className="summary-section-label">{t('busiestYear')}</div>
                <div className="summary-busiest">
                  <span className="summary-busiest-year">{stats.busiestEntry[0]}</span>
                  <span className="summary-busiest-count">
                    {t('milestoneCount', { count: stats.busiestEntry[1] })}
                  </span>
                </div>
              </div>
            )}

            {/* Decade breakdown */}
            {stats.decades.length > 0 && (
              <div className="summary-section">
                <div className="summary-section-label">{t('byDecade')}</div>
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
