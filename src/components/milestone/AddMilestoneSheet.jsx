import React, { useState } from 'react'
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

  const [title,     setTitle]     = useState(existing?.title     ?? '')
  const [month,     setMonth]     = useState('6')
  const [day,       setDay]       = useState('')
  const [year,      setYear]      = useState('')
  const [precision, setPrecision] = useState(existing?.date_precision ?? 'month')
  const [category,  setCategory]  = useState(existing?.category  ?? 'personal')
  const [note,      setNote]      = useState(existing?.note       ?? '')
  const [busy,      setBusy]      = useState(false)

  // Pre-fill date from existing
  React.useEffect(() => {
    if (existing?.date) {
      const d = new Date(existing.date)
      setMonth(String(d.getMonth() + 1))
      setDay(String(d.getDate()))
      setYear(String(d.getFullYear()))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
