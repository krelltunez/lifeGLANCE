import React, { useState } from 'react'

export default function IcsImportModal({ candidates, timedCount, categories, onImport, onClose }) {
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
          <span className="sheet-title">import from calendar</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        <p className="ics-notice">
          Import is designed for life milestones — birthdays, graduations, trips.
          Uncheck anything that doesn't belong.
        </p>

        <div className="ics-stats">
          <span>
            {candidates.length} all-day event{candidates.length !== 1 ? 's' : ''} found
          </span>
          {timedCount > 0 && (
            <span className="ics-stats-skipped">
              · {timedCount} timed event{timedCount !== 1 ? 's' : ''} skipped
            </span>
          )}
        </div>

        {candidates.length === 0 ? (
          <p className="ics-empty">No all-day events were found in this file.</p>
        ) : (
          <div className="ics-table-wrap">
            <table className="ics-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      title={allSelected ? 'deselect all' : 'select all'} />
                  </th>
                  <th>date</th>
                  <th>title</th>
                  <th>category</th>
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
                      {row.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="ics-col-title">
                      <span>{row.title}</span>
                      {row.isRecurring && <span className="ics-annual-badge">annual</span>}
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
          <button className="btn" onClick={onClose}>cancel</button>
          <button
            className="btn btn-filled"
            disabled={selectedCount === 0}
            onClick={handleImport}
          >
            import {selectedCount} milestone{selectedCount !== 1 ? 's' : ''}
          </button>
        </div>

      </div>
    </div>
  )
}
