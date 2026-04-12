import React from 'react'
import { formatDateDisplay, relativeLabel, ageAtDate } from '../../utils/dates'

export default function MilestoneDetail({ milestone: m, onClose, onEdit, onDelete, onDeleteSeries, birthday }) {
  function handleDelete() {
    if (window.confirm(`Delete "${m.title}"?`)) {
      onDelete(m.id)
      onClose()
    }
  }

  function handleDeleteSeries() {
    if (window.confirm(`Delete all instances of "${m.title}"?`)) {
      onDeleteSeries(m.recurrence_id)
      onClose()
    }
  }

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-header">
          <span className="sheet-title">milestone</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* Photo */}
        {m.photo_uri && (
          <div className="detail-photo-wrap">
            <img src={m.photo_uri} alt={m.title} className="detail-photo" />
          </div>
        )}

        {/* Title */}
        <div className="detail-title">{m.title}</div>

        {/* Meta */}
        <div className="detail-meta">
          <div className="detail-date-raw">
            {formatDateDisplay(m.date, m.date_precision)}
          </div>
          <div className="detail-relative">
            {relativeLabel(m.date, m.date_precision)}
          </div>
          {(() => {
            const age = birthday ? ageAtDate(birthday, m.date) : null
            return age !== null ? (
              <div className="detail-age">{age} y.o.</div>
            ) : null
          })()}
        </div>

        {/* Category */}
        <div className="detail-category">
          <div className="detail-cat-dot" style={{ background: m.color }} />
          {m.category}
        </div>

        {/* Recurrence badge */}
        {m.recurrence === 'annual' && (
          <div className="detail-recurrence">↻ repeats annually</div>
        )}

        {/* Note */}
        {m.note && (
          <div className="detail-note">{m.note}</div>
        )}

        {/* URL link */}
        {m.url && (
          <a href={m.url} target="_blank" rel="noopener noreferrer" className="detail-url">
            {m.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </a>
        )}

        {/* Actions */}
        <div className="sheet-actions">
          <div className="detail-delete-group">
            <button className="btn-ghost" onClick={handleDelete}>
              delete
            </button>
            {m.recurrence_id && onDeleteSeries && (
              <button className="btn-ghost detail-delete-series" onClick={handleDeleteSeries}>
                delete series
              </button>
            )}
          </div>
          <div className="sheet-actions-right">
            <button className="btn" onClick={() => { onClose(); onEdit(m); }}
              style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}
            >
              edit
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
