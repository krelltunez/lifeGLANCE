import React, { useState, useEffect } from 'react'
import { formatDateDisplay, relativeLabel, ageAtDate } from '../../utils/dates'
import { dbGetMedia } from '../../data/db'

export default function MilestoneDetail({ milestone: m, onClose, onEdit, onDelete, onDeleteSeries, birthday }) {
  const [audioUrl, setAudioUrl] = useState(null)
  const [confirm,  setConfirm]  = useState(null) // null | 'single' | 'series'

  useEffect(() => {
    if (!m.media_type) return
    let objectUrl
    dbGetMedia(m.id).then(result => {
      if (!result) return
      objectUrl = URL.createObjectURL(result.blob)
      setAudioUrl(objectUrl)
    })
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [m.id, m.media_type])

  function doDelete()       { onDelete(m.id); onClose() }
  function doDeleteSeries() { onDeleteSeries(m.recurrence_id); onClose() }

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


        {/* Media (audio / video) */}
        {audioUrl && (
          <div className="detail-audio-wrap">
            {m.media_type === 'video'
              ? <video controls src={audioUrl} className="detail-video" />
              : <audio controls src={audioUrl} className="detail-audio" />}
          </div>
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

        {/* Actions / inline confirmation */}
        {confirm ? (
          <div className="detail-confirm">
            <div className="detail-confirm-msg">
              {confirm === 'series'
                ? `delete all instances of "${m.title}"?`
                : `delete "${m.title}"?`}
            </div>
            <div className="detail-confirm-actions">
              <button className="btn" onClick={() => setConfirm(null)}
                style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}>
                cancel
              </button>
              <button className="btn btn-danger"
                onClick={confirm === 'series' ? doDeleteSeries : doDelete}
                style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}>
                {confirm === 'series' ? 'delete all' : 'delete'}
              </button>
            </div>
          </div>
        ) : (
          <div className="sheet-actions">
            <div className="detail-delete-group">
              <button className="btn-ghost" onClick={() => setConfirm('single')}>
                delete
              </button>
              {m.recurrence_id && onDeleteSeries && (
                <button className="btn-ghost detail-delete-series"
                  onClick={() => setConfirm('series')}>
                  delete series
                </button>
              )}
            </div>
            <div className="sheet-actions-right">
              <button className="btn" onClick={() => { onClose(); onEdit(m) }}
                style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}>
                edit
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
