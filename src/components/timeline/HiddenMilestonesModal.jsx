import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateDisplay, relativeLabel } from '../../utils/dates'

// Lists milestones explicitly hidden from the main timeline
// (mainTimelineVisibility === 'hidden'). Since a hidden milestone has no card to
// tap, this is the way back in: selecting a row opens its detail, where Edit →
// Visibility can set it back to Shown/Inherit.
export default function HiddenMilestonesModal({ items, onClose, onSelect }) {
  const { t } = useTranslation('timeline')

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-header">
          <span className="sheet-title">{t('hiddenMilestones')}</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        <p className="settings-note" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
          {t('hiddenMilestonesHint')}
        </p>

        <div className="otd-list">
          {items.map(m => (
            <div key={m.id} className="otd-item" onClick={() => onSelect(m)}>
              <div className="otd-dot" style={{ background: m.color }} />
              <div className="otd-content">
                <div className="otd-title">{m.title}</div>
                <div className="otd-meta">
                  {formatDateDisplay(m.date, m.date_precision)}
                  <span className="otd-years"> · {relativeLabel(m.date, m.date_precision)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
