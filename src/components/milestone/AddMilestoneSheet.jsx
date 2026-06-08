import React, { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_CATEGORIES } from '../../utils/colors'
import { buildDateFromParts } from '../../utils/dates'
import { dbGetPhoto } from '../../data/db'
import { getMilestoneVisibility } from '../../utils/visibility'
import { isIntegrationEnabled } from '../../lib/intentsTransport.js'

const MONTHS = [
  { v: '1',  l: 'Jan' }, { v: '2',  l: 'Feb' }, { v: '3',  l: 'Mar' },
  { v: '4',  l: 'Apr' }, { v: '5',  l: 'May' }, { v: '6',  l: 'Jun' },
  { v: '7',  l: 'Jul' }, { v: '8',  l: 'Aug' }, { v: '9',  l: 'Sep' },
  { v: '10', l: 'Oct' }, { v: '11', l: 'Nov' }, { v: '12', l: 'Dec' },
]

export default function AddMilestoneSheet({ onSave, onClose, existing, categories = DEFAULT_CATEGORIES, chapters = [], visibilityPrecomputed = { endpointChapterNames: new Map() }, drilledChapter = null }) {
  const { t } = useTranslation('milestone')
  const { t: tc } = useTranslation('common')
  const isEdit = !!existing

  const [title,      setTitle]      = useState(existing?.title     ?? '')
  const [month,      setMonth]      = useState('6')
  const [day,        setDay]        = useState('')
  const [year,       setYear]       = useState('')
  const [precision,  setPrecision]  = useState(existing?.date_precision ?? 'month')
  const [category,   setCategory]   = useState(existing?.category  ?? 'personal')
  const [note,       setNote]       = useState(existing?.note       ?? '')
  const [url,        setUrl]        = useState(existing?.url        ?? '')

  const [photoFile,       setPhotoFile]       = useState(null)
  const [photoObjectUrl,  setPhotoObjectUrl]  = useState(null)
  const [existingPhotoUrl, setExistingPhotoUrl] = useState(null)
  const [photoRemoved,    setPhotoRemoved]    = useState(false)

  const [mediaFile,     setMediaFile]     = useState(null)
  const [mediaRemoved,  setMediaRemoved]  = useState(false)
  const [mediaObjectUrl, setMediaObjectUrl] = useState(null)
  const [recurrence,      setRecurrence]      = useState(false)
  const [recEndYear,      setRecEndYear]      = useState('')
  const [visibility,      setVisibility]      = useState(existing?.mainTimelineVisibility ?? 'inherit')
  const [trackAsDg,       setTrackAsDg]       = useState(existing?.dayglance_linked ?? false)
  const integrationActive = isIntegrationEnabled()
  const [busy,          setBusy]          = useState(false)
  const photoRef = useRef(null)
  const mediaRef = useRef(null)

  const overlappingChapters = React.useMemo(() => {
    if (isEdit || year.length < 4) return []
    const date = buildDateFromParts(month, year, precision, day)
    if (!date) return []
    return chapters.filter(ch => date >= new Date(ch.start) && (ch.end === null || date <= new Date(ch.end)))
  }, [isEdit, month, day, year, precision, chapters])

  const [selectedChapterIds, setSelectedChapterIds] = React.useState(() => new Set())

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])


  React.useEffect(() => {
    if (isEdit) return
    const overlapIds = new Set(overlappingChapters.map(c => c.id))
    setSelectedChapterIds(
      drilledChapter && overlapIds.has(drilledChapter.id)
        ? new Set([drilledChapter.id])
        : new Set()
    )
  }, [overlappingChapters, drilledChapter, isEdit])

  function toggleChapter(id) {
    setSelectedChapterIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const closableChapters = React.useMemo(() => {
    if (isEdit || year.length < 4) return []
    const date = buildDateFromParts(month, year, precision, day)
    if (!date) return []
    return chapters.filter(ch => ch.end === null && date >= new Date(ch.start))
  }, [isEdit, month, day, year, precision, chapters])

  const [closeChapterIds, setCloseChapterIds] = React.useState(() => new Set())

  React.useEffect(() => {
    if (isEdit) return
    setCloseChapterIds(new Set())
  }, [closableChapters, isEdit])

  function toggleCloseChapter(id) {
    setCloseChapterIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const visInfo = React.useMemo(() => {
    if (!isEdit || !existing) return null
    const provisional = { ...existing, mainTimelineVisibility: visibility }
    return getMilestoneVisibility(provisional, chapters, visibilityPrecomputed, 'main')
  }, [isEdit, existing, visibility, chapters, visibilityPrecomputed])

  React.useEffect(() => {
    if (!isEdit || !existing?.has_photo) return
    let objectUrl
    dbGetPhoto(existing.id).then(result => {
      if (!result) return
      objectUrl = URL.createObjectURL(result.blob)
      setExistingPhotoUrl(objectUrl)
    })
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    return () => { if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl) }
  }, [photoObjectUrl])

  React.useEffect(() => {
    return () => { if (mediaObjectUrl) URL.revokeObjectURL(mediaObjectUrl) }
  }, [mediaObjectUrl])

  React.useEffect(() => {
    if (existing?.date) {
      const d = new Date(existing.date)
      setMonth(String(d.getUTCMonth() + 1))
      setDay(String(d.getUTCDate()))
      setYear(String(d.getUTCFullYear()))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (recurrence && year.length >= 4) {
      const base = Number(year)
      setRecEndYear(y => {
        const current = Number(y)
        const def = Math.max(base, new Date().getFullYear()) + 3
        return (!y || current < base) ? String(def) : y
      })
    }
  }, [recurrence, year])

  const dayValid = precision !== 'day' || (
    day && Number(day) >= 1 &&
    Number(day) <= new Date(Number(year), Number(month), 0).getDate()
  )
  const canSave = title.trim() && year.length >= 4 && dayValid

  const previewUrl    = photoFile ? photoObjectUrl : (!photoRemoved ? existingPhotoUrl : null)
  const hasExisting   = !photoRemoved && !!existing?.has_photo && !photoFile

  function handlePhotoSelect(file) {
    if (!file) return
    if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl)
    setPhotoFile(file)
    setPhotoRemoved(false)
    setPhotoObjectUrl(URL.createObjectURL(file))
  }

  function handlePhotoRemove() {
    if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl)
    setPhotoFile(null)
    setPhotoObjectUrl(null)
    setPhotoRemoved(true)
    if (photoRef.current) photoRef.current.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSave || busy) return
    setBusy(true)
    try {
      const date = buildDateFromParts(month, year, precision, day)
      const selectedCat = categories.find(c => c.id === category)
      const hasPhoto = photoFile
        ? true
        : (!photoRemoved && !!existing?.has_photo)
      await onSave({
        title: title.trim(),
        date,
        date_precision: precision,
        category,
        color: selectedCat?.color,
        note: note.trim(),
        has_photo: hasPhoto,
        photoFile,
        photoRemoved,
        mediaFile,
        mediaRemoved,
        url: url.trim(),
        mainTimelineVisibility: visibility,
        chapterIds: isEdit ? undefined : [...selectedChapterIds],
        closeChapterIds: isEdit ? undefined : [...closeChapterIds],
        recurrence: (!isEdit && recurrence) ? 'annual' : (existing?.recurrence ?? null),
        recurrence_id: existing?.recurrence_id ?? null,
        recurrenceEndYear: (!isEdit && recurrence && year.length >= 4)
          ? (recEndYear ? Number(recEndYear) : Math.max(Number(year), new Date().getFullYear()) + 3)
          : undefined,
        trackAsDayglanceGoal: integrationActive ? trackAsDg : false,
        dayglance_linked:       isEdit ? (integrationActive ? trackAsDg : (existing?.dayglance_linked ?? false)) : undefined,
        dayglance_task_id:      isEdit ? (existing?.dayglance_task_id ?? null)  : undefined,
        dayglance_completed:    isEdit ? (existing?.dayglance_completed ?? false) : undefined,
        dayglance_completed_at: isEdit ? (existing?.dayglance_completed_at ?? null) : undefined,
      }, existing)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="sheet" onSubmit={handleSubmit}>
        <div className="sheet-header">
          <span className="sheet-title">{isEdit ? t('editTitle') : t('addTitle')}</span>
          <button type="button" className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* Title */}
        <div className="sheet-field">
          <label className="field-label">{tc('eventName')}</label>
          <input
            className="input"
            type="text"
            placeholder={t('eventPlaceholder')}
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoComplete="off"
            maxLength={80}
            autoFocus
          />
        </div>

        {/* Date */}
        <div className="sheet-field">
          <label className="field-label">{tc('date')}</label>
          <div className="date-grid">
            {precision !== 'year' && (
              <div>
                <label className="field-label">{tc('month')}</label>
                <select
                  className="input input-sm"
                  value={month}
                  onChange={e => setMonth(e.target.value)}
                  style={{ cursor: 'pointer' }}
                >
                  {MONTHS.map(m => (
                    <option key={m.v} value={m.v}>{m.l}</option>
                  ))}
                </select>
              </div>
            )}

            {precision === 'day' && (
              <div>
                <label className="field-label">{tc('day')}</label>
                <input
                  className="input input-sm"
                  type="number"
                  placeholder="15"
                  value={day}
                  onChange={e => setDay(e.target.value)}
                  min="1" max="31"
                />
              </div>
            )}

            <div>
              <label className="field-label">{tc('year')}</label>
              <input
                className="input input-sm"
                type="number"
                placeholder="2020"
                value={year}
                onChange={e => setYear(e.target.value)}
                min="1900"
                max="2100"
              />
            </div>
          </div>

          {/* Precision toggle */}
          <div className="precision-tabs">
            {['day', 'month', 'year'].map(p => (
              <button
                key={p}
                type="button"
                className={`precision-tab ${precision === p ? 'active' : ''}`}
                onClick={() => setPrecision(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Category */}
        <div className="sheet-field">
          <label className="field-label">{t('category')}</label>
          <div className="category-grid">
            {categories.map(cat => (
              <div
                key={cat.id}
                className={`category-chip ${category === cat.id ? 'selected' : ''}`}
                onClick={() => setCategory(cat.id)}
              >
                <div className="category-chip-dot" style={{ background: cat.color }} />
                {cat.label}
              </div>
            ))}
          </div>
        </div>

        {/* Note */}
        <div className="sheet-field">
          <label className="field-label">{t('noteLabel')}</label>
          <textarea
            className="input"
            placeholder={t('notePlaceholder')}
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            style={{ resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* URL */}
        <div className="sheet-field">
          <label className="field-label">{t('linkLabel')}</label>
          <input
            className="input"
            type="url"
            placeholder="https://…"
            value={url}
            onChange={e => setUrl(e.target.value)}
            autoComplete="off"
          />
        </div>

        {/* Photo */}
        <div className="sheet-field">
          <label className="field-label">{t('photoLabel')}</label>
          {previewUrl ? (
            <div className="photo-preview-wrap">
              <img src={previewUrl} className="photo-preview" alt="milestone" />
              <button type="button" className="photo-remove" onClick={handlePhotoRemove}>
                {tc('remove')}
              </button>
            </div>
          ) : hasExisting ? (
            <div className="audio-attached-row">
              <span className="audio-attached-label">{t('photoAttached')}</span>
              <button type="button" className="btn-ghost" style={{ fontSize: '0.72rem' }}
                onClick={() => photoRef.current?.click()}>
                {tc('replace')}
              </button>
              <button type="button" className="btn-ghost" style={{ fontSize: '0.72rem' }}
                onClick={handlePhotoRemove}>
                {tc('remove')}
              </button>
            </div>
          ) : (
            <button type="button" className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem', alignSelf: 'flex-start' }}
              onClick={() => photoRef.current?.click()}>
              {t('attachPhoto')}
            </button>
          )}
          <input
            ref={photoRef} type="file" accept="image/*"
            style={{ display: 'none' }}
            onChange={e => handlePhotoSelect(e.target.files[0])}
          />
        </div>

        {/* Media (audio / video) */}
        <div className="sheet-field">
          <label className="field-label">{t('mediaLabel')}</label>
          {mediaFile && mediaObjectUrl ? (
            <div className="media-preview-wrap">
              {mediaFile.type.startsWith('video/')
                ? <video controls src={mediaObjectUrl} className="media-preview" />
                : <audio controls src={mediaObjectUrl} className="media-preview" />}
              <button type="button" className="btn-ghost" style={{ alignSelf: 'flex-start', fontSize: '0.72rem' }}
                onClick={() => {
                  setMediaFile(null)
                  setMediaRemoved(true)
                  setMediaObjectUrl(null)
                  if (mediaRef.current) mediaRef.current.value = ''
                }}>
                {tc('remove')}
              </button>
            </div>
          ) : existing?.media_type && !mediaRemoved ? (
            <div className="audio-attached-row">
              <span className="audio-attached-label">
                {existing.media_type === 'video' ? t('videoAttached') : t('audioAttached')}
              </span>
              <button type="button" className="btn-ghost" style={{ fontSize: '0.72rem' }}
                onClick={() => mediaRef.current?.click()}>
                {tc('replace')}
              </button>
              <button type="button" className="btn-ghost" style={{ fontSize: '0.72rem' }}
                onClick={() => { setMediaRemoved(true); setMediaFile(null) }}>
                {tc('remove')}
              </button>
            </div>
          ) : (
            <button type="button" className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem', alignSelf: 'flex-start' }}
              onClick={() => mediaRef.current?.click()}>
              {t('attachMedia')}
            </button>
          )}
          <input
            ref={mediaRef} type="file" accept="audio/*,video/*"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files[0]
              if (!file) return
              setMediaFile(file)
              setMediaRemoved(false)
              setMediaObjectUrl(URL.createObjectURL(file))
            }}
          />
        </div>

        {/* Recurrence (new milestones only) */}
        {!isEdit && (
          <div className="sheet-field">
            <label className="recurrence-toggle-row">
              <span className="field-label" style={{ marginBottom: 0 }}>{t('repeatsAnnually')}</span>
              <input type="checkbox" className="settings-toggle"
                checked={recurrence}
                onChange={e => { setRecurrence(e.target.checked); setRecEndYear('') }} />
            </label>
            {recurrence && year.length >= 4 && (() => {
              const base  = Number(year)
              const maxYear = base + 99
              const end   = Math.min(
                recEndYear ? Number(recEndYear) : Math.max(base, new Date().getFullYear()) + 3,
                maxYear
              )
              const count = Math.max(0, end - base + 1)
              return (
                <div className="recurrence-range-row">
                  <span className="recurrence-range-from">{year}</span>
                  <span className="recurrence-range-arrow">→</span>
                  <input
                    type="number"
                    className="input input-sm"
                    style={{ width: '5.2rem' }}
                    value={recEndYear}
                    placeholder={String(Math.max(base, new Date().getFullYear()) + 3)}
                    onChange={e => {
                      const v = e.target.value
                      if (!v) { setRecEndYear(''); return }
                      setRecEndYear(String(Math.min(Math.max(Number(v), base), maxYear)))
                    }}
                    min={year}
                    max={maxYear}
                  />
                  <span className="recurrence-range-count">
                    {t('recurrenceCount', { count })}
                  </span>
                </div>
              )
            })()}
          </div>
        )}
        {isEdit && existing?.recurrence === 'annual' && (
          <div className="sheet-field">
            <div className="detail-recurrence-warn">{t('repeatsAnnuallyEditWarning')}</div>
          </div>
        )}

        {/* Visibility (edit mode only) */}
        {isEdit && (
          <div className="sheet-field">
            <label className="field-label">{t('visibilityLabel')}</label>

            {visInfo?.reason === 'endpoint' && (
              <div className="vis-endpoint-notice">
                <span className="vis-endpoint-icon">⚓</span>
                <span>
                  {t('endpointNotice', { chapters: visInfo.endpointChapters.map(ch => `'${ch}'`).join(', ') })}
                </span>
              </div>
            )}

            <div className="vis-toggle-row">
              {['inherit', 'shown', 'hidden'].map(v => (
                <button
                  key={v}
                  type="button"
                  className={`vis-tab${visibility === v ? ' active' : ''}`}
                  onClick={() => setVisibility(v)}
                >
                  {v}
                </button>
              ))}
            </div>

            {visInfo && (
              <div className={`vis-status ${visInfo.visible ? 'vis-status-shown' : 'vis-status-hidden'}`}>
                {visInfo.reason === 'endpoint' && t('visEndpoint')}
                {visInfo.reason === 'milestone-shown' && t('visShownExplicit')}
                {visInfo.reason === 'milestone-hidden' && t('visHiddenExplicit')}
                {visInfo.reason === 'cascade-shown' && t('visInheritShown', { source: visInfo.inheritSource })}
                {visInfo.reason === 'cascade-hidden' && t('visInheritHidden', { source: visInfo.inheritSource })}
                {visInfo.reason === 'no-chapters' && t('visNoChapters')}
              </div>
            )}
          </div>
        )}

        {/* dayGLANCE Goal tracking */}
        {integrationActive && (() => {
          const isFuture = isEdit
            ? (existing?.direction === 'future' || existing?.dayglance_linked)
            : (year.length >= 4 && Number(year) >= new Date().getFullYear())
          if (!isFuture) return null
          return (
            <div className="sheet-field">
              <label className="recurrence-toggle-row">
                <span className="field-label" style={{ marginBottom: 0 }}>
                  {t('trackAsDayglance')}
                </span>
                <input
                  type="checkbox"
                  className="settings-toggle"
                  checked={trackAsDg}
                  onChange={e => setTrackAsDg(e.target.checked)}
                />
              </label>
              {trackAsDg && (
                <p className="settings-note" style={{ marginTop: '0.35rem' }}>
                  {t('trackAsDayglanceNote')}
                </p>
              )}
            </div>
          )
        })()}

        {/* Chapter membership suggestion */}
        {!isEdit && overlappingChapters.length > 0 && (
          <div className="sheet-field">
            <label className="field-label">{t('addToChapters')}</label>
            <div className="chapter-members-list">
              {overlappingChapters.map(ch => (
                <label key={ch.id} className="chapter-member-row">
                  <input
                    type="checkbox"
                    className="chapter-member-check"
                    checked={selectedChapterIds.has(ch.id)}
                    onChange={() => toggleChapter(ch.id)}
                  />
                  <span className="chapter-member-dot" style={{ background: ch.color }} />
                  <span className="chapter-member-title">{ch.title}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Close ongoing chapters */}
        {!isEdit && closableChapters.length > 0 && (
          <div className="sheet-field">
            <label className="field-label">{t('closeChapterLabel')}</label>
            <div className="chapter-members-list">
              {closableChapters.map(ch => (
                <label key={ch.id} className="chapter-member-row">
                  <input
                    type="checkbox"
                    className="chapter-member-check"
                    checked={closeChapterIds.has(ch.id)}
                    onChange={() => toggleCloseChapter(ch.id)}
                  />
                  <span className="chapter-member-dot" style={{ background: ch.color }} />
                  <span className="chapter-member-title">{ch.title}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="sheet-actions">
          <span />
          <div className="sheet-actions-right">
            <button type="button" className="btn" onClick={onClose} style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}>
              {tc('cancel')}
            </button>
            <button type="submit" className="btn btn-filled" disabled={!canSave || busy} style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}>
              {busy ? tc('saving') : isEdit ? tc('saveChanges') : t('addToTimeline')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
