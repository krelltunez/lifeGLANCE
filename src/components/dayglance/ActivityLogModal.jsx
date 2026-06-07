import React, { useState, useCallback } from 'react'
import { loadActivityLog, clearActivityLog } from '../../lib/intentsActivityLog.js'

function formatTs(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function entryLabel(entry) {
  const title = entry.payload?.title ?? entry.payload?.task_id ?? entry.action
  if (entry.type === 'sent') return `Sent "${title}" to dayGLANCE`
  const event = entry.payload?.event
  if (event === 'completed') return `"${title}" completed in dayGLANCE`
  if (event === 'rescheduled') return `"${title}" rescheduled in dayGLANCE`
  return `Received "${title}" from dayGLANCE`
}

export default function ActivityLogModal({ onClose }) {
  const [entries, setEntries] = useState(loadActivityLog)

  const handleRefresh = useCallback(() => setEntries(loadActivityLog()), [])

  const handleClear = useCallback(() => {
    clearActivityLog()
    setEntries([])
  }, [])

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet settings-sheet">
        <div className="sheet-header">
          <span className="sheet-title" style={{ letterSpacing: '0.08em', fontSize: '0.8rem' }}>
            ACTIVITY LOG
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button className="btn" style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }} onClick={handleRefresh}>
              ↻ Refresh
            </button>
            <button className="btn" style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }} onClick={handleClear}>
              Clear
            </button>
            <button className="sheet-close" onClick={onClose}>&#x2715;</button>
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="settings-note" style={{ marginTop: '1rem', textAlign: 'center' }}>
            No activity yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {entries.map((e, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.65rem 0',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                fontSize: '0.82rem',
              }}>
                <span style={{ color: 'var(--text-dim)', minWidth: '8rem', fontSize: '0.75rem' }}>
                  {formatTs(e.timestamp)}
                </span>
                <span style={{
                  fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em',
                  padding: '0.15rem 0.5rem', borderRadius: '3px', flexShrink: 0,
                  background: e.type === 'sent' ? '#2a3a6e' : '#0f2a1a',
                  color:      e.type === 'sent' ? '#7aadff'  : '#34D399',
                }}>
                  {e.type === 'sent' ? 'SENT' : 'RECEIVED'}
                </span>
                <span style={{ color: 'var(--text-main)' }}>{entryLabel(e)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
