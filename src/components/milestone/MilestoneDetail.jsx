import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Capacitor } from '@capacitor/core'
import { formatDateDisplay, relativeLabel, ageAtDate } from '../../utils/dates'
import { dbGetMedia, dbGetPhoto, dbPutMedia } from '../../data/db'
import { isRealBlobHash, fetchFullResBytes, fetchFullResBytesChunked, fetchThumbnailBytes } from '../../blobs/milestoneMedia.js'

// Bytes → "X.X MB" for the download-progress label.
const fmtMB = (n) => `${(n / 1048576).toFixed(1)} MB`

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
  const [mediaLoading, setMediaLoading] = useState(null) // { received, total } while downloading a remote clip
  const [posterUrl, setPosterUrl] = useState(null) // video poster (from the uploaded thumbnail)
  const [confirm,   setConfirm]   = useState(null)
  const [pins,      setPins]      = useState(readPins)
  const [showPinHelp, setShowPinHelp] = useState(false)

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

  // Media (audio/video). LOCAL-FIRST: if this device holds the local blob (the
  // originating device, or one that cached it), stream it straight from IndexedDB
  // into the <video>/<audio> element — the element ranges over the blob on demand,
  // so a large (e.g. 89 MB) clip plays without loading + AES-GCM-decrypting the
  // whole thing into memory (which stalls the WebView). Only when there is NO
  // local copy (a receiving device that hasn't cached it) do we download + decrypt
  // the vault blob. A missing blob leaves audioUrl null → the "media unavailable"
  // placeholder renders below.
  useEffect(() => {
    if (!m.media_type) return
    let objectUrl, cancelled = false
    const show = (blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setAudioUrl(objectUrl)
    }
    dbGetMedia(m.id).then(local => {
      if (cancelled) return
      if (local?.blob) { show(local.blob); return } // local-first: no download needed
      if (!isRealBlobHash(m.media_id)) return
      // No local copy (a receiving device): download the blob in bounded chunks so a
      // large video doesn't stall the WebView, decrypt, cache it locally so the next
      // open is instant (local-first), then play. Progress drives the label below.
      const type = m.media_type === 'video' ? 'video/mp4' : 'audio/mpeg'
      setMediaLoading({ received: 0, total: null })
      fetchFullResBytesChunked(m.media_id, {
        onProgress: (received, total) => { if (!cancelled) setMediaLoading({ received, total }) },
      }).then(async bytes => {
        if (cancelled) return
        if (!bytes) { setMediaLoading(null); return }
        const blob = new Blob([bytes], { type })
        try { await dbPutMedia(m.id, blob, type) } catch { /* cache is best-effort */ }
        if (cancelled) return
        setMediaLoading(null)
        show(blob)
      }).catch(() => { if (!cancelled) setMediaLoading(null) })
    }).catch(() => {})
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [m.id, m.media_type, m.media_id])

  // Video poster: the uploaded thumbnail (thumbnail_id) is a small blob, so fetch +
  // decrypt it (cached in-memory) and use it as the <video poster>, replacing the
  // default blank "big play button" with the captured frame.
  useEffect(() => {
    if (m.media_type !== 'video' || !isRealBlobHash(m.thumbnail_id)) { setPosterUrl(null); return }
    let objectUrl, cancelled = false
    fetchThumbnailBytes(m.thumbnail_id).then(bytes => {
      if (cancelled || !bytes) return
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
      setPosterUrl(objectUrl)
    }).catch(() => {})
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [m.media_type, m.thumbnail_id])

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

  // Label for the media-unavailable / downloading state (shared by the plain and
  // poster-backed renders below).
  const mediaLabel = mediaLoading
    ? t('mediaDownloading', {
        progress: mediaLoading.total
          ? `${fmtMB(mediaLoading.received)} / ${fmtMB(mediaLoading.total)}`
          : fmtMB(mediaLoading.received),
      })
    : t('mediaSyncedFromDevice')

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
              ? <video controls poster={posterUrl || undefined} src={audioUrl} className="detail-video" />
              : <audio controls src={audioUrl} className="detail-audio" />}
          </div>
        )}
        {m.media_type && !audioUrl && (
          posterUrl && m.media_type === 'video' ? (
            // Show the poster frame with the status (e.g. "Downloading… X.X MB")
            // overlaid, so a large video previews immediately while it downloads.
            <div className="detail-audio-wrap" style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
              <img src={posterUrl} alt="" className="detail-video" />
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.4)', color: '#fff', fontSize: '0.85rem', lineHeight: 1.3,
                textAlign: 'center', padding: '0.5rem', borderRadius: 'inherit',
              }}>
                {mediaLabel}
              </div>
            </div>
          ) : (
            <div className="detail-audio-wrap detail-media-unavailable">
              <span className="detail-media-unavailable-label">{mediaLabel}</span>
            </div>
          )
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
          <>
            {canPin && showPinHelp && (
              <div className="detail-pin-help"
                style={{ fontSize: '0.72rem', opacity: 0.72, lineHeight: 1.45, padding: '0 0 0.55rem' }}>
                {t('pinHelp')}
              </div>
            )}
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
                <div className="detail-pin-slots" title={t('pinCluster')}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', marginRight: '6px' }}>
                  <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>📌</span>
                  {PIN_SLOTS.map(s => {
                    const active = pins[s.id] === m.id
                    const label = active
                      ? t('unpinFromWidget', { color: t(`pinColor_${s.id}`) })
                      : t('pinToWidget', { color: t(`pinColor_${s.id}`) })
                    return (
                      <button key={s.id} type="button" onClick={() => toggleSlot(s.id)}
                        title={label}
                        aria-label={label}
                        aria-pressed={active}
                        style={{
                          width: '18px', height: '18px', borderRadius: '50%', padding: 0,
                          border: `2px solid ${s.color}`,
                          background: active ? s.color : 'transparent',
                          cursor: 'pointer',
                        }} />
                    )
                  })}
                  <button type="button" onClick={() => setShowPinHelp(v => !v)}
                    title={t('pinHelpToggle')}
                    aria-label={t('pinHelpToggle')}
                    aria-expanded={showPinHelp}
                    style={{
                      width: '18px', height: '18px', borderRadius: '50%', padding: 0,
                      marginLeft: '2px', border: '1px solid currentColor',
                      background: 'transparent', color: 'inherit', opacity: showPinHelp ? 0.85 : 0.5,
                      cursor: 'pointer', fontSize: '0.7rem', lineHeight: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>?</button>
                </div>
              )}
              <button className="btn" onClick={() => { onClose(); onEdit(m) }}
                style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}>
                {tc('edit')}
              </button>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  )
}
