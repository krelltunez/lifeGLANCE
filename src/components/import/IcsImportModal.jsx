import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export default function IcsImportModal({ candidates, timedCount, categories, onImport, onClose }) {
  const { t, i18n } = useTranslation('import')
  const { t: tc } = useTranslation('common')

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])


  const [rows, setRows] = useState(candidates)

  const selectedCount = rows.filter(r => r.selected).length

  function toggleAll() {
    const allOn = rows.every(r => r.selected)
    setRows(rs => rs.map(r => ({ ...r, selected: !allOn })))
  }

  function toggleRow(key) {
    setRows(rs => rs.map(r => r.key === key ? { ...r, selected: !r.selected } : r))
  }

  function setCategory(key, cat) {
    setRows(rs => rs.map(r => r.key === key ? { ...r, category: cat } : r))
  }

  function handleImport() {
    onImport(rows.filter(r => r.selected))
  }

  const allSelected = rows.length > 0 && rows.every(r => r.selected)

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ics-sheet">

        <div className="sheet-header">
          <span className="sheet-title">{t('title')}</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        <p className="ics-notice">
          {t('notice')}
        </p>

        <div className="ics-stats">
          <span>
            {t('allDayEventsFound', { count: candidates.length })}
          </span>
          {timedCount > 0 && (
            <span className="ics-stats-skipped">
              {t('timedEventsSkipped', { count: timedCount })}
            </span>
          )}
        </div>

        {candidates.length === 0 ? (
          <p className="ics-empty">{t('noEvents')}</p>
        ) : (
          <div className="ics-table-wrap">
            <table className="ics-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      title={allSelected ? t('deselectAll') : t('selectAll')} />
                  </th>
                  <th>{tc('date')}</th>
                  <th>{t('titleColumn')}</th>
                  <th>{t('categoryColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.key} className={row.selected ? '' : 'ics-row-dim'}>
                    <td>
                      <input type="checkbox" checked={row.selected}
                        onChange={() => toggleRow(row.key)} />
                    </td>
                    <td className="ics-col-date">
                      {row.date.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="ics-col-title">
                      <span>{row.title}</span>
                      {row.isRecurring && <span className="ics-annual-badge">{t('annual')}</span>}
                    </td>
                    <td className="ics-col-cat">
                      <select
                        className="ics-cat-select"
                        value={row.category}
                        onChange={e => setCategory(row.key, e.target.value)}
                      >
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="ics-actions">
          <button className="btn" onClick={onClose}>{tc('cancel')}</button>
          <button
            className="btn btn-filled"
            disabled={selectedCount === 0}
            onClick={handleImport}
          >
            {t('importButton', { count: selectedCount })}
          </button>
        </div>

      </div>
    </div>
  )
}
