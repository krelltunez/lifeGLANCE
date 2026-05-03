import React, { useState, useMemo, useEffect } from 'react'

const CHAPTER_COLORS = [
  { hex: '#C8A96E', label: 'amber'  },
  { hex: '#3D3580', label: 'indigo' },
  { hex: '#E8748A', label: 'coral'  },
  { hex: '#9370DB', label: 'purple' },
]

function fmtDate(m) {
  const d = new Date(m.date)
  if (m.date_precision === 'year')
    return String(d.getUTCFullYear())
  if (m.date_precision === 'month')
    return d.toLocaleString('default', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  return d.toLocaleString('default', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export default function ChapterSheet({ onSave, onClose, onDelete, existing, milestones = [] }) {
  const isEdit = !!existing

  const [title,          setTitle]          = useState(existing?.title       ?? '')
  const [start,          setStart]          = useState(existing?.start ? existing.start.slice(0, 10) : '')
  const [end,            setEnd]            = useState(existing?.end   ? existing.end.slice(0, 10)   : '')
  const [color,          setColor]          = useState(existing?.color ?? CHAPTER_COLORS[0].hex)
  const [desc,           setDesc]           = useState(existing?.description ?? '')
  const [defVis,         setDefVis]         = useState(existing?.defaultMemberVisibility ?? 'shown')
  const [checkedIds,     setCheckedIds]     = useState(() => new Set(existing?.milestoneIds ?? []))
  const [confirmDelete,  setConfirmDelete]  = useState(false)
  const [dateError,      setDateError]      = useState(null)
  const [busy,           setBusy]           = useState(false)

  // Milestones whose dates fall within [start, end]
  const inRange = useMemo(() => {
    if (!start || !end) return []
    const s = new Date(start)
    const e = new Date(end)
    if (s > e) return []
    return milestones
      .filter(m => { const d = new Date(m.date); return d >= s && d <= e })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
  }, [start, end, milestones])

  const inRangeIds = useMemo(() => new Set(inRange.map(m => m.id)), [inRange])

  // Create mode: auto-check all in-range milestones when the range changes.
  // Edit mode: existing memberships are controlled only by the user.
  useEffect(() => {
    if (isEdit) return
    setCheckedIds(new Set(inRange.map(m => m.id)))
  }, [inRange, isEdit])

  // Display list:
  //   create — milestones in range (auto-checked by default)
  //   edit   — union of in-range milestones (appear unchecked if not members) and
  //            currently-checked members (preserved even if outside the new range)
  const displayMilestones = useMemo(() => {
    if (!isEdit) return inRange
    return milestones
      .filter(m => inRangeIds.has(m.id) || checkedIds.has(m.id))
      .sort((a, b) => new Date(a.date) - new Date(b.date))
  }, [isEdit, inRange, inRangeIds, checkedIds, milestones])

  function toggleId(id) {
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function clearDateError() { setDateError(null) }

  function validateDates() {
    if (!start || !end) { setDateError('both dates are required'); return false }
    if (new Date(start) >= new Date(end)) {
      setDateError('end date must be after start date')
      return false
    }
    return true
  }

  const canSave = title.trim() && start && end && !busy

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validateDates() || !canSave) return
    setBusy(true)
    try {
      await onSave(
        {
          title:                  title.trim(),
          start,
          end,
          color,
          description:            desc.trim(),
          defaultMemberVisibility: defVis,
          milestoneIds:           [...checkedIds],
        },
        existing,
      )
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    try {
      await onDelete(existing.id)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="sheet" onSubmit={handleSubmit}>

        {/* Header */}
        <div className="sheet-header">
          <span className="sheet-title">{isEdit ? 'edit chapter' : 'add chapter'}</span>
          <button type="button" className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* Title */}
        <div className="sheet-field">
          <label className="field-label">chapter name</label>
          <input
            className="input"
            type="text"
            placeholder="e.g. College years"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
            autoComplete="off"
            maxLength={80}
          />
        </div>

        {/* Date range */}
        <div className="sheet-field">
          <label className="field-label">date range</label>
          <div className="chapter-date-row">
            <div className="chapter-date-field">
              <label className="field-label">from</label>
              <input
                className="input input-sm"
                type="date"
                value={start}
                onChange={e => { setStart(e.target.value); clearDateError() }}
              />
            </div>
            <span className="chapter-date-arrow">→</span>
            <div className="chapter-date-field">
              <label className="field-label">to</label>
              <input
                className="input input-sm"
                type="date"
                value={end}
                onChange={e => { setEnd(e.target.value); clearDateError() }}
              />
            </div>
          </div>
          {dateError && <div className="chapter-date-error">{dateError}</div>}
        </div>

        {/* Color */}
        <div className="sheet-field">
          <label className="field-label">color</label>
          <div className="chapter-color-row">
            {CHAPTER_COLORS.map(c => (
              <button
                key={c.hex}
                type="button"
                className={`chapter-color-swatch ${color === c.hex ? 'selected' : ''}`}
                style={{ background: c.hex }}
                onClick={() => setColor(c.hex)}
                title={c.label}
              />
            ))}
          </div>
        </div>

        {/* Description */}
        <div className="sheet-field">
          <label className="field-label">description (optional)</label>
          <textarea
            className="input"
            rows={2}
            placeholder="A short description of this chapter…"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            maxLength={300}
            style={{ resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* Default member visibility */}
        <div className="sheet-field">
          <label className="settings-toggle-row">
            <span className="field-label" style={{ marginBottom: 0 }}>
              hide members from main timeline by default
            </span>
            <input
              type="checkbox"
              className="settings-toggle"
              checked={defVis === 'hidden'}
              onChange={e => setDefVis(e.target.checked ? 'hidden' : 'shown')}
            />
          </label>
        </div>

        {/* Member milestones */}
        <div className="sheet-field">
          <label className="field-label">
            milestones in this chapter
            {displayMilestones.length > 0 && (
              <span className="chapter-member-count"> — {[...checkedIds].filter(id => displayMilestones.some(m => m.id === id)).length} selected</span>
            )}
          </label>
          {!start || !end ? (
            <div className="chapter-members-empty">set a date range above to see milestones</div>
          ) : displayMilestones.length === 0 ? (
            <div className="chapter-members-empty">no milestones in this date range</div>
          ) : (
            <div className="chapter-members-list">
              {displayMilestones.map(m => {
                // Endpoint: milestone date matches the chapter's start or end (day-level comparison).
                // Only checked members can be endpoints — unchecked milestones aren't members yet.
                const mDay      = m.date?.slice(0, 10)
                const startDay  = start
                const endDay    = end
                const isEndpoint = checkedIds.has(m.id) &&
                  mDay && (mDay === startDay || mDay === endDay)

                return (
                  <label key={m.id} className="chapter-member-row">
                    <input
                      type="checkbox"
                      className="chapter-member-check"
                      checked={checkedIds.has(m.id)}
                      onChange={() => toggleId(m.id)}
                    />
                    <span
                      className="chapter-member-dot"
                      style={{ background: m.color ?? 'var(--text-muted)' }}
                    />
                    <span className={`chapter-member-title${isEdit && !inRangeIds.has(m.id) ? ' chapter-member-retained' : ''}`}>
                      {m.title}
                    </span>
                    {isEndpoint && (
                      <span className="chapter-member-endpoint" title="endpoint — always shown on main timeline">⚓</span>
                    )}
                    <span className="chapter-member-date">{fmtDate(m)}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {/* Delete — edit mode only */}
        {isEdit && (
          confirmDelete ? (
            <div className="detail-confirm">
              <div className="detail-confirm-msg">
                delete <strong style={{ color: 'var(--text)' }}>{existing.title}</strong>?
                milestones in this chapter will not be deleted — they will simply no longer
                be part of this chapter.
              </div>
              <div className="detail-confirm-actions">
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDelete}
                  disabled={busy}
                >
                  {busy ? 'deleting…' : 'yes, delete chapter'}
                </button>
              </div>
            </div>
          ) : (
            <div className="sheet-field">
              <button
                type="button"
                className="btn btn-danger"
                style={{ alignSelf: 'flex-start', fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
                onClick={() => setConfirmDelete(true)}
              >
                delete chapter
              </button>
            </div>
          )
        )}

        {/* Actions */}
        <div className="sheet-actions">
          <span />
          <div className="sheet-actions-right">
            <button
              type="button"
              className="btn"
              onClick={onClose}
              style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}
            >
              cancel
            </button>
            <button
              type="submit"
              className="btn btn-filled"
              disabled={!canSave || busy}
              style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}
            >
              {busy ? 'saving…' : isEdit ? 'save changes' : 'add chapter'}
            </button>
          </div>
        </div>

      </form>
    </div>
  )
}
