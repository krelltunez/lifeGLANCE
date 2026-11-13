import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { lifeName, lifeColor } from './lifeLabels'

// Share Lives (Lives v5.0, Phase 5b): choose which Lives go in the file. Only
// their milestones, chapters, photos and the relationships between them are
// included (buildBackup({ lifeIds }) in src/data/backup.js).
export default function ShareSheet({ lives, currentLifeId, onClose, onShare }) {
  const { t } = useTranslation('lives')
  const { t: tc } = useTranslation('common')
  const [chosen, setChosen] = useState(() => new Set([currentLifeId]))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (id) => setChosen(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet lives-sheet">
        <div className="sheet-header">
          <span className="sheet-title">{t('shareTitle')}</span>
          <button type="button" className="sheet-close" onClick={onClose}>✕</button>
        </div>
        <p className="lives-intro">{t('shareIntro')}</p>
        <div className="chapter-members-list">
          {lives.map(l => (
            <label key={l.id} className="chapter-member-row">
              <input type="checkbox" className="chapter-member-check" checked={chosen.has(l.id)} onChange={() => toggle(l.id)} />
              <span className="chapter-member-dot" style={{ background: lifeColor(l) }} />
              <span className="chapter-member-title">{lifeName(l, t)}</span>
            </label>
          ))}
        </div>
        <div className="sheet-actions">
          <span />
          <div className="sheet-actions-right">
            <button type="button" className="btn" onClick={onClose}>{tc('cancel')}</button>
            <button type="button" className="btn btn-filled" disabled={busy || chosen.size === 0}
              onClick={async () => { setBusy(true); try { await onShare([...chosen]) } finally { setBusy(false) } }}>
              {t('shareButton')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
