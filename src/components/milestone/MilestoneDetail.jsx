import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Capacitor } from '@capacitor/core'
import { formatDateDisplay, relativeLabel, ageAtDate } from '../../utils/dates'
import { dbGetMedia, dbGetPhoto } from '../../data/db'
import { isRealBlobHash, fetchFullResBytes } from '../../blobs/milestoneMedia.js'

const PINS_KEY = 'lifeglance-pins'
// Color pin slots — each maps to its own countdown widget. Keep in sync with PIN_SLOTS
// in widgetSnapshot.js and the native slot widgets.
const PIN_SLOTS = [
  { id: 'amber', color: '#C8A96E' },
  { id: 'rose',  color: '#E85D75' },
  { id: 'teal',  color: '#38B2AC' },
  { id: 'blue',  color: '#4A90D9' },
]
const readPins = () => {
  try { return JSON.parse(localStorage.getItem(PINS_KEY) || '{}') } catch { return {} }
}

export default function MilestoneDetail({ milestone: m, onClose, onEdit, onDelete, onDeleteSeries, birthday, categories = [] }) {
  const { t, i18n } = useTranslation('milestone')
  const { t: tc } = useTranslation('common')
  const [audioUrl,  setAudioUrl]  = useState(null)
  const [photoUrl,  setPhotoUrl]  = useState(null)
  const [mediaDiag, setMediaDiag] = useState(null) // TEMP: on-device media state readout
  const [confirm,   setConfirm]   = useState(null)
  const [pins,      setPins]      = useState(readPins)

  // Each color slot maps to its own countdown widget. Tapping a slot pins this milestone
  // to it (or clears it), then nudges the widget snapshot to re-push. Native shells only.
  const canPin = Capacitor.isNativePlatform()
  function toggleSlot(slot) {
    const next = { ...readPins() }
    if (next[slot] === m.id) delete next[slot]
    else next[slot] = m.id
    localStorage.setItem(PINS_KEY, JSON.stringify(next))
    setPins(next)
    window.dispatchEvent(new Event('lifeglance:widget-refresh'))
  }

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Media (audio/video): a real-hash media_id resolves from the GLANCEvault blob
  // store (lazy, on open); a legacy/placeholder slot resolves from the local
  // media store. A fetch failure (blob not yet uploaded / reclaimed) leaves
  // audioUrl null → the graceful "media unavailable" placeholder renders below.
  useEffect(() => {
    if (!m.media_type) { setMediaDiag(null); return }
    let objectUrl, cancelled = false
    const show = (blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setAudioUrl(objectUrl)
    }
    // TEMP DIAGNOSTIC: record the actual on-device media state so a failing case
    // reveals WHICH layer is at fault — id kind (real vs local placeholder), a
    // local blob present + its size, and (for a real id) the fetch outcome.
    const real = isRealBlobHash(m.media_id)
    const parts = [`type=${m.media_type}`, real ? `id=real:${String(m.media_id).slice(0, 10)}` : 'id=placeholder']
    const mb = (n) => `${(n / 1048576).toFixed(1)}MB`
    // Set SYNCHRONOUSLY so the line renders immediately — its presence proves this
    // (DIAG3) build is actually running (vs a stale cached bundle); its absence
    // means the app is serving old code.
    setMediaDiag(`DIAG3 · ${parts.join(' · ')} · probing local…`)
    // Bound the local read so a stall shows up instead of leaving the line stuck.
    const withTimeout = (p, ms, label) =>
      Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms))])
    // Always probe the local store (even for a real id) so we know whether a local
    // copy exists on this device.
    withTimeout(dbGetMedia(m.id), 8000, 'dbGetMedia').then(result => {
      if (cancelled) return
      parts.push(result?.blob ? `local=${mb(result.blob.size)}` : 'local=NONE')
      if (real) {
        const type = m.media_type === 'video' ? 'video/mp4' : 'audio/mpeg'
        fetchFullResBytes(m.media_id).then(b => {
          if (cancelled) return
          if (b) { parts.push(`fetch=${mb(b.length)}`); show(new Blob([b], { type })) }
          else parts.push('fetch=null')
          setMediaDiag('DIAG3 · ' + parts.join(' · '))
        }).catch(e => { if (!cancelled) { parts.push(`fetch!=${e?.name || 'err'}:${String(e?.message || '').slice(0, 40)}`); setMediaDiag('DIAG3 · ' + parts.join(' · ')) } })
      } else {
        show(result?.blob)
        setMediaDiag('DIAG3 · ' + parts.join(' · '))
      }
    }).catch(e => { if (!cancelled) { parts.push(`local!=${String(e?.message || e).slice(0, 40)}`); setMediaDiag('DIAG3 · ' + parts.join(' · ')) } })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [m.id, m.media_type, m.media_id])

  useEffect(() => {
    if (!m.has_photo) return
    let objectUrl, cancelled = false
    const show = (blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setPhotoUrl(objectUrl)
    }
    if (isRealBlobHash(m.photo_id)) {
      // No stored mime on the slot; <img> content-sniffs an untyped image blob.
      fetchFullResBytes(m.photo_id).then(b => show(b && new Blob([b]))).catch(() => {})
    } else {
      dbGetPhoto(m.id).then(result => show(result?.blob)).catch(() => {})
    }
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [m.id, m.has_photo, m.photo_id])

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
            <span className="detail-media-unavailable-icon">&var(--success-accent);</span>
            <span className="detail-media-unavailable-label">{t('photoSyncedFromDevice')}</span>
          </div>
        )}

        {/* Title */}
        <div className="detail-title">{m.title}</div>

        {/* Meta */}
        <div className="detail-meta">
          <div className="detail-date-raw">
            {formatDateDisplay(m.date, m.date_precision, i18n.language)}
          </div>
          <div className="detail-relative">
            {relativeLabel(m.date, m.date_precision)}
          </div>
          {(() => {
            const age = birthday ? ageAtDate(birthday, m.date) : null
            return age !== null ? (
              <div className="detail-age">{t('ageYearsOld', { age })}</div>
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
                {' '}· {new Date(m.dayglance_completed_at).toLocaleDateString(i18n.language)}
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
            {mediaDiag && (
              <span style={{ display: 'block', marginTop: 4, fontSize: '0.68rem', opacity: 0.75, wordBreak: 'break-all', fontFamily: 'monospace' }}>
                {mediaDiag}
              </span>
            )}
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
              {canPin && (
                <div className="detail-pin-slots" title="Pin to a countdown widget"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', marginRight: '6px' }}>
                  <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>📌</span>
                  {PIN_SLOTS.map(s => {
                    const active = pins[s.id] === m.id
                    return (
                      <button key={s.id} type="button" onClick={() => toggleSlot(s.id)}
                        title={active ? `Unpin from ${s.id} widget` : `Pin to ${s.id} widget`}
                        aria-label={active ? `Unpin from ${s.id} widget` : `Pin to ${s.id} widget`}
                        aria-pressed={active}
                        style={{
                          width: '18px', height: '18px', borderRadius: '50%', padding: 0,
                          border: `2px solid ${s.color}`,
                          background: active ? s.color : 'transparent',
                          cursor: 'pointer',
                        }} />
                    )
                  })}
                </div>
              )}
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
