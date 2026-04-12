import React from 'react'
import { formatDateDisplay } from '../../utils/dates'

export default function OnThisDayModal({ items, onClose, onSelect }) {
  const today     = new Date()
  const todayYear = today.getFullYear()

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-header">
          <span className="sheet-title">on this day</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        <div className="otd-list">
          {items.map(m => {
            const yearsAgo = todayYear - new Date(m.date).getFullYear()
            return (
              <div key={m.id} className="otd-item" onClick={() => onSelect(m)}>
                <div className="otd-dot" style={{ background: m.color }} />
                <div className="otd-content">
                  <div className="otd-title">{m.title}</div>
                  <div className="otd-meta">
                    {formatDateDisplay(m.date, m.date_precision)}
                    {yearsAgo > 0 && (
                      <span className="otd-years">
                        {' '}· {yearsAgo} year{yearsAgo !== 1 ? 's' : ''} ago
                      </span>
                    )}
                    {m.date_precision === 'month' && (
                      <span className="otd-approx"> (approx.)</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
