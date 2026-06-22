import React, { useState, useMemo, useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { buildDateFromParts } from '../../utils/dates'

const CHAPTER_COLORS = [
  { hex: 'var(--amber)', label: 'amber'   },
  { hex: 'var(--indigo)', label: 'indigo'  },
  { hex: 'var(--rose-soft)', label: 'coral'   },
  { hex: 'var(--purple)', label: 'purple'  },
  { hex: 'var(--teal)', label: 'teal'    },
  { hex: 'var(--success-muted)', label: 'green'   },
  { hex: 'var(--accent-blue)', label: 'blue'    },
  { hex: 'var(--cat-orange)', label: 'orange'  },
  { hex: 'var(--cat-magenta)', label: 'fuchsia' },
  { hex: 'var(--cat-red)', label: 'red'     },
]

const MONTHS = [
  { v: '1',  l: 'Jan' }, { v: '2',  l: 'Feb' }, { v: '3',  l: 'Mar' },
  { v: '4',  l: 'Apr' }, { v: '5',  l: 'May' }, { v: '6',  l: 'Jun' },
  { v: '7',  l: 'Jul' }, { v: '8',  l: 'Aug' }, { v: '9',  l: 'Sep' },
  { v: '10', l: 'Oct' }, { v: '11', l: 'Nov' }, { v: '12', l: 'Dec' },
]

function fmtDate(m) {
  const d = new Date(m.date)
  if (m.date_precision === 'year')
    return String(d.getUTCFullYear())
  if (m.date_precision === 'month')
    return d.toLocaleString('default', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  return d.toLocaleString('default', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function parseIso(iso) {
  if (!iso) return { month: '1', day: '', year: '' }
  const d = new Date(iso)
  return {
    month: String(d.getUTCMonth() + 1),
    day:   String(d.getUTCDate()),
    year:  String(d.getUTCFullYear()),
  }
}

export default function ChapterSheet({ onSave, onClose, onDelete, existing, milestones = [] }) {
  const { t } = useTranslation('chapter')
  const { t: tc } = useTranslation('common')
  const isEdit = !!existing

  const initStart = parseIso(existing?.start)
  const initEnd   = parseIso(existing?.end)

  const [title,          setTitle]          = useState(existing?.title       ?? '')
  const [startMonth,     setStartMonth]     = useState(initStart.month)
  const [startDay,       setStartDay]       = useState(initStart.day)
  const [startYear,      setStartYear]      = useState(initStart.year)
  const [startPrecision, setStartPrecision] = useState('month')
  const [ongoing,        setOngoing]        = useState(existing ? !existing.end : false)
  const [endMonth,       setEndMonth]       = useState(initEnd.month)
  const [endDay,         setEndDay]         = useState(initEnd.day)
  const [endYear,        setEndYear]        = useState(initEnd.year)
  const [endPrecision,   setEndPrecision]   = useState('month')
  const [color,          setColor]          = useState(existing?.color ?? CHAPTER_COLORS[0].hex)
  const [desc,           setDesc]           = useState(existing?.description ?? '')
  const [defVis,         setDefVis]         = useState(existing?.defaultMemberVisibility ?? 'shown')
  const [checkedIds,     setCheckedIds]     = useState(() => new Set(existing?.milestoneIds ?? []))
  const [confirmDelete,  setConfirmDelete]  = useState(false)
  const [dateError,      setDateError]      = useState(null)
  const [busy,           setBusy]           = useState(false)

  const startDate = startYear.length >= 4
    ? buildDateFromParts(startMonth, startYear, startPrecision, startDay) : null
  const endDate = endYear.length >= 4
    ? buildDateFromParts(endMonth, endYear, endPrecision, endDay) : null

  const startIso = startDate ? startDate.toISOString() : null
  const endIso   = endDate   ? endDate.toISOString()   : null

  const effectiveEndDate = ongoing ? new Date() : endDate
  const inRange = useMemo(() => {
    if (!startDate || !effectiveEndDate) return []
    if (startDate >= effectiveEndDate) return []
    return milestones
      .filter(m => { const d = new Date(m.date); return d >= startDate && d <= effectiveEndDate })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
  }, [startIso, endIso, ongoing, milestones])

  const inRangeIds = useMemo(() => new Set(inRange.map(m => m.id)), [inRange])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])


  useEffect(() => {
    if (isEdit) return
    setCheckedIds(new Set(inRange.map(m => m.id)))
  }, [inRange, isEdit])

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

  function selectAll()  { setCheckedIds(new Set(displayMilestones.map(m => m.id))) }
  function selectNone() { setCheckedIds(new Set()) }

  function clearDateError() { setDateError(null) }

  function validateDates() {
    if (!startIso) { setDateError(t('errorStartRequired')); return false }
    if (startPrecision === 'day' && startYear.length >= 4) {
      const maxDay = new Date(Number(startYear), Number(startMonth), 0).getDate()
      if (Number(startDay) < 1 || Number(startDay) > maxDay) {
        setDateError(t('errorStartDayRange', { max: maxDay }))
        return false
      }
    }
    if (!ongoing) {
      if (!endIso) { setDateError(t('errorEndRequired')); return false }
      if (endPrecision === 'day' && endYear.length >= 4) {
        const maxDay = new Date(Number(endYear), Number(endMonth), 0).getDate()
        if (Number(endDay) < 1 || Number(endDay) > maxDay) {
          setDateError(t('errorEndDayRange', { max: maxDay }))
          return false
        }
      }
      if (new Date(startIso) >= new Date(endIso)) {
        setDateError(t('errorEndAfterStart'))
        return false
      }
    }
    return true
  }

  const canSave = title.trim() && startIso && (ongoing || endIso) && !busy

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validateDates() || !canSave) return
    setBusy(true)
    try {
      await onSave(
        {
          title:                  title.trim(),
          start:                  startIso,
          end:                    ongoing ? null : endIso,
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
          <span className="sheet-title">{isEdit ? t('editTitle') : t('addTitle')}</span>
          <button type="button" className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* Title */}
        <div className="sheet-field">
          <label className="field-label">{t('nameLabel')}</label>
          <input
            className="input"
            type="text"
            placeholder={t('namePlaceholder')}
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
            autoComplete="off"
            maxLength={80}
          />
        </div>

        {/* Date range */}
        <div className="sheet-field">
          <label className="field-label">{t('dateRange')}</label>

          {/* Start date */}
          <label className="field-label" style={{ marginTop: '0.5rem' }}>{t('from')}</label>
          <div className="date-grid">
            {startPrecision !== 'year' && (
              <div>
                <label className="field-label">{tc('month')}</label>
                <select
                  className="input input-sm"
                  value={startMonth}
                  onChange={e => { setStartMonth(e.target.value); clearDateError() }}
                  style={{ cursor: 'pointer' }}
                >
                  {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                </select>
              </div>
            )}
            {startPrecision === 'day' && (
              <div>
                <label className="field-label">{tc('day')}</label>
                <input
                  className="input input-sm"
                  type="number"
                  placeholder="15"
                  value={startDay}
                  onChange={e => { setStartDay(e.target.value); clearDateError() }}
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
                value={startYear}
                onChange={e => { setStartYear(e.target.value); clearDateError() }}
                min="1900" max="2100"
              />
            </div>
          </div>
          <div className="precision-tabs">
            {['day', 'month', 'year'].map(p => (
              <button key={p} type="button"
                className={`precision-tab ${startPrecision === p ? 'active' : ''}`}
                onClick={() => setStartPrecision(p)}
              >{p}</button>
            ))}
          </div>

          {/* Ongoing toggle */}
          <label className="settings-toggle-row" style={{ marginTop: '0.75rem' }}>
            <span className="field-label" style={{ marginBottom: 0 }}>{t('ongoing')}</span>
            <input
              type="checkbox"
              className="settings-toggle"
              checked={ongoing}
              onChange={e => { setOngoing(e.target.checked); clearDateError() }}
            />
          </label>

          {!ongoing && (
            <>
              <div className="date-grid">
                {endPrecision !== 'year' && (
                  <div>
                    <label className="field-label">{tc('month')}</label>
                    <select
                      className="input input-sm"
                      value={endMonth}
                      onChange={e => { setEndMonth(e.target.value); clearDateError() }}
                      style={{ cursor: 'pointer' }}
                    >
                      {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                    </select>
                  </div>
                )}
                {endPrecision === 'day' && (
                  <div>
                    <label className="field-label">{tc('day')}</label>
                    <input
                      className="input input-sm"
                      type="number"
                      placeholder="15"
                      value={endDay}
                      onChange={e => { setEndDay(e.target.value); clearDateError() }}
                      min="1" max="31"
                    />
                  </div>
                )}
                <div>
                  <label className="field-label">{tc('year')}</label>
                  <input
                    className="input input-sm"
                    type="number"
                    placeholder="2024"
                    value={endYear}
                    onChange={e => { setEndYear(e.target.value); clearDateError() }}
                    min="1900" max="2100"
                  />
                </div>
              </div>
              <div className="precision-tabs">
                {['day', 'month', 'year'].map(p => (
                  <button key={p} type="button"
                    className={`precision-tab ${endPrecision === p ? 'active' : ''}`}
                    onClick={() => setEndPrecision(p)}
                  >{p}</button>
                ))}
              </div>
            </>
          )}

          {dateError && <div className="chapter-date-error">{dateError}</div>}
        </div>

        {/* Color */}
        <div className="sheet-field">
          <label className="field-label">{t('colorLabel')}</label>
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
          <label className="field-label">{t('descriptionLabel')}</label>
          <textarea
            className="input"
            rows={2}
            placeholder={t('descriptionPlaceholder')}
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
              {t('hideByDefault')}
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
            {t('membersLabel')}
            {displayMilestones.length > 0 && (
              <span className="chapter-member-count">
                {t('membersSelected', { count: [...checkedIds].filter(id => displayMilestones.some(m => m.id === id)).length })}
              </span>
            )}
          </label>
          {!startIso || (!ongoing && !endIso) ? (
            <div className="chapter-members-empty">{t('membersEmpty')}</div>
          ) : displayMilestones.length === 0 ? (
            <div className="chapter-members-empty">{t('membersNoMilestones')}</div>
          ) : (
            <>
            <div className="chapter-member-actions">
              <button type="button" className="chapter-member-action" onClick={selectAll}>{t('selectAll')}</button>
              <span className="chapter-member-action-sep" aria-hidden="true">·</span>
              <button type="button" className="chapter-member-action" onClick={selectNone}>{t('selectNone')}</button>
            </div>
            <div className="chapter-members-list">
              {displayMilestones.map(m => {
                const mDay        = m.date?.slice(0, 10)
                const sDay        = startDate?.toISOString().slice(0, 10)
                const eDay        = ongoing ? null : endDate?.toISOString().slice(0, 10)
                const isDateMatch = !!(mDay && (mDay === sDay || (!ongoing && mDay === eDay)))
                const isEndpoint  = checkedIds.has(m.id) && isDateMatch

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
                    {isDateMatch && (
                      <span
                        className={`chapter-member-endpoint${isEndpoint ? '' : ' chapter-member-endpoint-dim'}`}
                        title={isEndpoint ? t('endpointTooltip') : t('endpointDimTooltip')}
                      >⚓</span>
                    )}
                    <span className="chapter-member-date">{fmtDate(m)}</span>
                  </label>
                )
              })}
            </div>
            </>
          )}
        </div>

        {/* Delete — edit mode only */}
        {isEdit && (
          confirmDelete ? (
            <div className="detail-confirm">
              <div className="detail-confirm-msg">
                <Trans
                  ns="chapter"
                  i18nKey="deleteConfirmTitle"
                  values={{ title: existing.title }}
                  components={{ strong: <strong style={{ color: 'var(--text)' }} /> }}
                />
                {' '}{t('deleteConfirmMsg')}
              </div>
              <div className="detail-confirm-actions">
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  {tc('cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDelete}
                  disabled={busy}
                >
                  {busy ? tc('deleting') : t('confirmDelete')}
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
                {t('deleteButton')}
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
              {tc('cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-filled"
              disabled={!canSave || busy}
              style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}
            >
              {busy ? tc('saving') : isEdit ? tc('saveChanges') : t('addTitle')}
            </button>
          </div>
        </div>

      </form>
    </div>
  )
}
