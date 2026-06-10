import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateDisplay, relativeLabel, ageAtDate } from '../../utils/dates'
import { dbGetMedia, dbGetPhoto } from '../../data/db'

export default function MilestoneDetail({ milestone: m, onClose, onEdit, onDelete, onDeleteSeries, birthday, categories = [] }) {
  const { t } = useTranslation('milestone')
  const { t: tc } = useTranslation('common')
  const [audioUrl,  setAudioUrl]  = useState(null)
  const [photoUrl,  setPhotoUrl]  = useState(null)
  const [confirm,   setConfirm]   = useState(null)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

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

  useEffect(() => {
    if (!m.has_photo) return
    let objectUrl
    dbGetPhoto(m.id).then(result => {
      if (!result) return
      objectUrl = URL.createObjectURL(result.blob)
      setPhotoUrl(objectUrl)
    })
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [m.id, m.has_photo])

  function doDelete()       { onDelete(m.id); onClose() }
  function doDeleteSeries() { onDeleteSeries(m.recurrence_id); onClose() }

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-header">
          <span className="sheet-title">{t('detailTitle')}</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* Photo */}
        {m.has_photo && photoUrl && (
          <div className="detail-photo-wrap">
            <img src={photoUrl} alt={m.title} className="detail-photo" />
          </div>
        )}
        {m.has_photo && !photoUrl && (
          <div className="detail-photo-wrap detail-media-unavailable">
            <span className="detail-media-unavailable-icon">&#128247;</span>
            <span className="detail-media-unavailable-label">{t('photoSyncedFromDevice')}</span>
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
          {categories.find(c => c.id === m.category)?.label ?? m.category}
        </div>

        {/* Recurrence badge */}
        {m.recurrence === 'annual' && (
          <div className="detail-recurrence">{t('repeatsAnnuallyIcon')}</div>
        )}

        {/* dayGLANCE link badges */}
        {m.dayglance_linked && !m.dayglance_completed && (
          <div className="detail-dg-badge">
            <span className="detail-dg-icon">◈</span> {t('trackedInDayglance')}
          </div>
        )}
        {m.dayglance_completed && (
          <div className="detail-dg-badge detail-dg-badge--done">
            <span className="detail-dg-icon">✓</span> {t('completedInDayglance')}
            {m.dayglance_completed_at && (
              <span className="detail-dg-when">
                {' '}· {new Date(m.dayglance_completed_at).toLocaleDateString()}
              </span>
            )}
          </div>
        )}

        {/* Media (audio / video) */}
        {m.media_type && audioUrl && (
          <div className="detail-audio-wrap">
            {m.media_type === 'video'
              ? <video controls src={audioUrl} className="detail-video" />
              : <audio controls src={audioUrl} className="detail-audio" />}
          </div>
        )}
        {m.media_type && !audioUrl && (
          <div className="detail-audio-wrap detail-media-unavailable">
            <span className="detail-media-unavailable-label">{t('mediaSyncedFromDevice')}</span>
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
                ? t('deleteSeriesConfirm', { title: m.title })
                : t('deleteConfirm', { title: m.title })}
            </div>
            <div className="detail-confirm-actions">
              <button className="btn" onClick={() => setConfirm(null)}
                style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}>
                {tc('cancel')}
              </button>
              <button className="btn btn-danger"
                onClick={confirm === 'series' ? doDeleteSeries : doDelete}
                style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}>
                {confirm === 'series' ? t('deleteAll') : tc('delete')}
              </button>
            </div>
          </div>
        ) : (
          <div className="sheet-actions">
            <div className="detail-delete-group">
              <button className="btn-ghost" onClick={() => setConfirm('single')}>
                {tc('delete')}
              </button>
              {m.recurrence_id && onDeleteSeries && (
                <button className="btn-ghost detail-delete-series"
                  onClick={() => setConfirm('series')}>
                  {t('deleteSeries')}
                </button>
              )}
            </div>
            <div className="sheet-actions-right">
              <button className="btn" onClick={() => { onClose(); onEdit(m) }}
                style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}>
                {tc('edit')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
