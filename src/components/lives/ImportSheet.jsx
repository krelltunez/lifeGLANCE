import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { fileLives, planImport, previewImport, applyImport } from '../../data/importMerge'
import { ME_LIFE_ID } from '../../data/db'
import { MultipleLivesBlockedError } from '../../sync/lifeGate'
import { lifeName } from './lifeLabels'
import { GatePanel } from './LivesSheet'

// Import and merge (Lives v5.0, Phase 5b): what to do with each Life in the
// file, a preview of what will change, then the import. src/data/importMerge.js
// has the rules. Nothing is written until Import.
export default function ImportSheet({ backup, lives, onClose, onDone }) {
  const { t, i18n } = useTranslation('lives')
  const { t: tc } = useTranslation('common')
  const inFile = fileLives(backup)
  const [decisions, setDecisions] = useState(() => planImport(backup, lives))
  const [counts, setCounts] = useState(null)
  const [error, setError] = useState(null)
  const [blocked, setBlocked] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    previewImport(backup, decisions).then(c => { if (live) setCounts(c) }).catch(() => {})
    return () => { live = false }
  }, [backup, decisions])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fileLabel = (f) => (f.id === ME_LIFE_ID
    ? (f.nickname ? t('fileMeNick', { nickname: f.nickname }) : t('fileMe'))
    : f.name)
  const fmtDate = (d) => {
    try { return new Date(`${d}T00:00:00Z`).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) }
    catch { return d }
  }
  const valueOf = (d) => (d.action === 'match' ? `match:${d.targetId}` : d.action)
  const setRow = (id, value) => {
    setError(null)
    setDecisions(prev => {
      const f = inFile.find(x => x.id === id)
      const next = value.startsWith('match:') ? { action: 'match', targetId: value.slice(6) }
        : value === 'new' ? { action: 'new', name: prev[id]?.name ?? (f.id === ME_LIFE_ID ? f.nickname ?? '' : f.name ?? '') }
        : { action: 'skip' }
      return { ...prev, [id]: next }
    })
  }
  const setName = (id, name) => { setError(null); setDecisions(prev => ({ ...prev, [id]: { ...prev[id], name } })) }

  async function run() {
    if (Object.values(decisions).some(d => d.action === 'new' && !d.name?.trim())) { setError(t('nameRequired')); return }
    setBusy(true)
    try {
      const done = await applyImport(backup, decisions)
      onDone(done)
    } catch (err) {
      if (err instanceof MultipleLivesBlockedError) setBlocked(true)
      else { console.error('Import failed:', err); setError(err.message) }
    } finally { setBusy(false) }
  }

  if (blocked) {
    return (
      <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="sheet lives-sheet">
          <GatePanel t={t} footer={t('gateImportFooter')} onBack={() => setBlocked(false)} onClose={onClose} />
        </div>
      </div>
    )
  }

  const summary = counts && [
    counts.livesAdded > 0 && t('importLivesAdded', { count: counts.livesAdded }),
    t('importMilestonesAdded', { count: counts.milestonesAdded }),
    counts.milestonesMerged > 0 && t('importMilestonesMerged', { count: counts.milestonesMerged }),
    counts.milestonesLeftOut > 0 && t('importMilestonesLeftOut', { count: counts.milestonesLeftOut }),
    (counts.chaptersAdded + counts.chaptersMerged) > 0 && t('importChapters', { count: counts.chaptersAdded + counts.chaptersMerged }),
    counts.relationshipsAdded > 0 && t('importRelationships', { count: counts.relationshipsAdded }),
  ].filter(Boolean)

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet lives-sheet">
        <div className="sheet-header">
          <span className="sheet-title">{t('importTitle')}</span>
          <button type="button" className="sheet-close" onClick={onClose}>✕</button>
        </div>
        <p className="lives-intro">{t('importIntro')}</p>

        {inFile.map(f => {
          const d = decisions[f.id] ?? { action: 'skip' }
          return (
            <div key={f.id} className="sheet-field">
              {/* Names keep their case: .field-label lowercases. */}
              <label className="lives-import-who" htmlFor={`import-${f.id}`}>
                {fileLabel(f)}
                {f.birthDate && <span className="lives-import-born">{fmtDate(f.birthDate)}</span>}
              </label>
              <select id={`import-${f.id}`} className="input" style={{ cursor: 'pointer' }}
                value={valueOf(d)} onChange={e => setRow(f.id, e.target.value)}>
                {lives.map(l => <option key={l.id} value={`match:${l.id}`}>{t('importSameAs', { name: lifeName(l, t) })}</option>)}
                <option value="new">{t('importAsNew')}</option>
                <option value="skip">{t('importSkip')}</option>
              </select>
              {d.action === 'new' && (
                <input className="input" aria-label={t('nameLabel')} placeholder={t('nameLabel')}
                  value={d.name ?? ''} onChange={e => setName(f.id, e.target.value)} />
              )}
            </div>
          )
        })}

        {summary && (
          <ul className="lives-impact">
            {summary.map(line => <li key={line}>{line}</li>)}
          </ul>
        )}
        <p className="lives-intro">{t('importNoUndo')}</p>
        {error && <div className="lives-error" role="alert">{error}</div>}

        <div className="sheet-actions">
          <span />
          <div className="sheet-actions-right">
            <button type="button" className="btn" onClick={onClose}>{tc('cancel')}</button>
            <button type="button" className="btn btn-filled" disabled={busy} onClick={run}>{t('importButton')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
