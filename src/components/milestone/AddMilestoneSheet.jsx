import React, { useState, useRef } from 'react'
import { DEFAULT_CATEGORIES } from '../../utils/colors'
import { buildDateFromParts } from '../../utils/dates'

const MONTHS = [
  { v: '1',  l: 'Jan' }, { v: '2',  l: 'Feb' }, { v: '3',  l: 'Mar' },
  { v: '4',  l: 'Apr' }, { v: '5',  l: 'May' }, { v: '6',  l: 'Jun' },
  { v: '7',  l: 'Jul' }, { v: '8',  l: 'Aug' }, { v: '9',  l: 'Sep' },
  { v: '10', l: 'Oct' }, { v: '11', l: 'Nov' }, { v: '12', l: 'Dec' },
]

export default function AddMilestoneSheet({ onSave, onClose, existing, categories = DEFAULT_CATEGORIES }) {
  const isEdit = !!existing

  const [title,      setTitle]      = useState(existing?.title     ?? '')
  const [month,      setMonth]      = useState('6')
  const [day,        setDay]        = useState('')
  const [year,       setYear]       = useState('')
  const [precision,  setPrecision]  = useState(existing?.date_precision ?? 'month')
  const [category,   setCategory]   = useState(existing?.category  ?? 'personal')
  const [note,       setNote]       = useState(existing?.note       ?? '')
  const [url,        setUrl]        = useState(existing?.url        ?? '')
  const [photoUri,      setPhotoUri]      = useState(existing?.photo_uri ?? '')
  const [mediaFile,     setMediaFile]     = useState(null)   // new File selected this session
  const [mediaRemoved,  setMediaRemoved]  = useState(false)  // user cleared existing media
  const [mediaObjectUrl, setMediaObjectUrl] = useState(null) // transient preview URL
  const [recurrence,    setRecurrence]    = useState(false)
  const [recEndYear,    setRecEndYear]    = useState('')
  const [busy,          setBusy]          = useState(false)
  const photoRef = useRef(null)
  const mediaRef = useRef(null)

  // Revoke preview URL when it changes or the form unmounts
  React.useEffect(() => {
    return () => { if (mediaObjectUrl) URL.revokeObjectURL(mediaObjectUrl) }
  }, [mediaObjectUrl])

  // Pre-fill date from existing
  React.useEffect(() => {
    if (existing?.date) {
      const d = new Date(existing.date)
      setMonth(String(d.getMonth() + 1))
      setDay(String(d.getDate()))
      setYear(String(d.getFullYear()))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the recurrence end-year default in sync with the base year
  React.useEffect(() => {
    if (recurrence && year.length >= 4) {
      const base = Number(year)
      setRecEndYear(y => {
        // only override if blank or user hasn't manually changed it
        const current = Number(y)
        const def = Math.max(base, new Date().getFullYear()) + 3
        return (!y || current < base) ? String(def) : y
      })
    }
  }, [recurrence, year])

  const canSave = title.trim() && year.length >= 4

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSave || busy) return
    setBusy(true)
    try {
      const date = buildDateFromParts(month, year, precision, day)
      const selectedCat = categories.find(c => c.id === category)
      await onSave({
        title: title.trim(),
        date,
        date_precision: precision,
        category,
        color: selectedCat?.color,
        note: note.trim(),
        photo_uri: photoUri,
        mediaFile,
        mediaRemoved,
        url: url.trim(),
        recurrence: (!isEdit && recurrence) ? 'annual' : (existing?.recurrence ?? null),
        recurrence_id: existing?.recurrence_id ?? null,
        recurrenceEndYear: (!isEdit && recurrence && year.length >= 4)
          ? (recEndYear ? Number(recEndYear) : Math.max(Number(year), new Date().getFullYear()) + 3)
          : undefined,
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
          <span className="sheet-title">{isEdit ? 'edit milestone' : 'add milestone'}</span>
          <button type="button" className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* Title */}
        <div className="sheet-field">
          <label className="field-label">event name</label>
          <input
            className="input"
            type="text"
            placeholder="e.g. Moved to Portland"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoComplete="off"
            maxLength={80}
            autoFocus
          />
        </div>

        {/* Date */}
        <div className="sheet-field">
          <label className="field-label">date</label>
          <div className="date-grid">
            {precision !== 'year' && (
              <div>
                <label className="field-label">month</label>
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
                <label className="field-label">day</label>
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
              <label className="field-label">year</label>
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
          <label className="field-label">category</label>
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
          <label className="field-label">note (optional)</label>
          <textarea
            className="input"
            placeholder="Any details you want to remember…"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            style={{ resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* URL */}
        <div className="sheet-field">
          <label className="field-label">link (optional)</label>
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
          <label className="field-label">photo (optional)</label>
          {photoUri ? (
            <div className="photo-preview-wrap">
              <img src={photoUri} className="photo-preview" alt="milestone" />
              <button type="button" className="photo-remove"
                onClick={() => { setPhotoUri(''); if (photoRef.current) photoRef.current.value = '' }}>
                remove
              </button>
            </div>
          ) : (
            <button type="button" className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem', alignSelf: 'flex-start' }}
              onClick={() => photoRef.current?.click()}>
              attach photo
            </button>
          )}
          <input
            ref={photoRef} type="file" accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = () => setPhotoUri(reader.result)
              reader.readAsDataURL(file)
            }}
          />
        </div>

        {/* Media (audio / video) */}
        <div className="sheet-field">
          <label className="field-label">audio / video (optional)</label>
          {mediaFile && mediaObjectUrl ? (
            // New file selected this session — show inline preview
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
                remove
              </button>
            </div>
          ) : existing?.media_type && !mediaRemoved ? (
            // Existing media — show indicator with replace/remove
            <div className="audio-attached-row">
              <span className="audio-attached-label">
                {existing.media_type === 'video' ? '▶ video attached' : '♪ audio attached'}
              </span>
              <button type="button" className="btn-ghost" style={{ fontSize: '0.72rem' }}
                onClick={() => mediaRef.current?.click()}>
                replace
              </button>
              <button type="button" className="btn-ghost" style={{ fontSize: '0.72rem' }}
                onClick={() => { setMediaRemoved(true); setMediaFile(null) }}>
                remove
              </button>
            </div>
          ) : (
            <button type="button" className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem', alignSelf: 'flex-start' }}
              onClick={() => mediaRef.current?.click()}>
              attach audio / video
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
              <span className="field-label" style={{ marginBottom: 0 }}>repeats annually</span>
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
                    {count} instance{count !== 1 ? 's' : ''}
                  </span>
                </div>
              )
            })()}
          </div>
        )}
        {isEdit && existing?.recurrence === 'annual' && (
          <div className="sheet-field">
            <div className="detail-recurrence-warn">↻ repeats annually — editing this instance only</div>
          </div>
        )}

        {/* Actions */}
        <div className="sheet-actions">
          <span />
          <div className="sheet-actions-right">
            <button type="button" className="btn" onClick={onClose} style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}>
              cancel
            </button>
            <button type="submit" className="btn btn-filled" disabled={!canSave || busy} style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}>
              {busy ? 'saving…' : isEdit ? 'save changes' : 'add to timeline'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
