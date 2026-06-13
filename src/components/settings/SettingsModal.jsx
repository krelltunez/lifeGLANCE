import React, { useRef, useState, useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { saveCategories } from '../../utils/colors'
import { isMuted, setMuted } from '../../utils/audio'
import IntegrationSettings from '../dayglance/IntegrationSettings'

const TEXT_SIZES_ALL = ['small', 'normal', 'big', 'bigger']

const COLOR_PALETTE = [
  'var(--purple)', 'var(--cat-violet)', 'var(--cat-indigo)', 'var(--indigo)',
  'var(--accent-blue)', 'var(--cat-blue)', 'var(--teal)', 'var(--success)',
  'var(--success-muted)', 'var(--amber)', 'var(--cat-orange)', 'var(--amber-bright)',
  'var(--rose)', 'var(--cat-pink)', 'var(--cat-magenta)', 'var(--cat-red)',
]

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function SettingsModal({
  textSize, onTextSizeChange,
  categories, onCategoriesChange,
  clustering, onClusteringChange,
  idleAutoStart, onIdleAutoStartChange,
  idleTimeoutMs, onIdleTimeoutChange, idleTimeoutOptions = [],
  birthday, onBirthdayChange,
  milestones,
  onExportImage, onSaveBackup, onRestoreFile, onImportIcsFile,
  onOpenCloudSync,
  onOpenAutoBackup,
  onOpenActivityLog,
  onClose,
  ultraCompact = false,
}) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const [newLabel,   setNewLabel]   = useState('')
  const [newColor,   setNewColor]   = useState(COLOR_PALETTE[0])
  const [soundOn,    setSoundOn]    = useState(() => !isMuted())
  const [persisted,  setPersisted]  = useState(null)
  const fileRef    = useRef(null)
  const icsFileRef = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    navigator.storage?.persisted?.()
      .then(p => setPersisted(p))
      .catch(() => {})
  }, [])

  async function handleRequestPersist() {
    const granted = await navigator.storage?.persist?.()
    setPersisted(!!granted)
  }

  const usedIds = new Set(milestones.map(m => m.category))

  function handleAdd() {
    const label = newLabel.trim()
    if (!label) return
    const id  = slugify(label) + '-' + Math.random().toString(36).slice(2, 6)
    const cat = { id, label: label.toLowerCase(), color: newColor }
    const updated = [...categories, cat]
    saveCategories(updated)
    onCategoriesChange(updated)
    setNewLabel('')
  }

  function handleDelete(id) {
    const updated = categories.filter(c => c.id !== id)
    saveCategories(updated)
    onCategoriesChange(updated)
  }

  async function handleFileChange(e) {
    await onRestoreFile(e)
    onClose()
  }

  async function handleIcsFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    await onImportIcsFile(file)
    onClose()
  }

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet settings-sheet">
        <div className="sheet-header">
          <span className="sheet-title">{t('title')}</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Text size ─────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">{t('textSizeLabel')}</div>
          {ultraCompact ? (
            <div className="settings-note">{t('textSizeUnavailable')}</div>
          ) : (
            <div className="zoom-tabs">
              {TEXT_SIZES_ALL.map(s => (
                <button key={s}
                  className={`zoom-tab ${textSize === s ? 'active' : ''}`}
                  onClick={() => onTextSizeChange(s)}>{s}</button>
              ))}
            </div>
          )}
        </div>

        {/* ── Display ───────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">{t('displayLabel')}</div>
          <label className="settings-toggle-row">
            <span className="settings-toggle-label">{t('clustering')}</span>
            <input type="checkbox" className="settings-toggle"
              checked={clustering}
              onChange={e => onClusteringChange(e.target.checked)} />
          </label>
          <label className="settings-toggle-row">
            <span className="settings-toggle-label">{t('soundEffects')}</span>
            <input type="checkbox" className="settings-toggle"
              checked={soundOn}
              onChange={e => { setSoundOn(e.target.checked); setMuted(!e.target.checked) }} />
          </label>
          {onIdleAutoStartChange && (
            <>
              <label className="settings-toggle-row">
                <span className="settings-toggle-label">{t('idleAutoStart')}</span>
                <input type="checkbox" className="settings-toggle"
                  checked={idleAutoStart}
                  onChange={e => onIdleAutoStartChange(e.target.checked)} />
              </label>
              {idleAutoStart && idleTimeoutOptions.length > 0 && (
                <div className="settings-idle-timeout">
                  <span className="settings-toggle-label">{t('idleTimeout')}</span>
                  <div className="zoom-tabs">
                    {idleTimeoutOptions.map(opt => (
                      <button key={opt.ms}
                        className={`zoom-tab ${idleTimeoutMs === opt.ms ? 'active' : ''}`}
                        onClick={() => onIdleTimeoutChange(opt.ms)}>{opt.label}</button>
                    ))}
                  </div>
                </div>
              )}
              <p className="settings-note" style={{ marginTop: '0.4rem' }}>{t('idleNote')}</p>
            </>
          )}
        </div>

        {/* ── Categories ────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">{t('categoriesLabel')}</div>

          <div className="settings-cat-list">
            {categories.map(cat => {
              const inUse = usedIds.has(cat.id)
              return (
                <div key={cat.id} className="settings-cat-row">
                  <div className="settings-cat-dot" style={{ background: cat.color }} />
                  <span className="settings-cat-name">{cat.label}</span>
                  {inUse && <span className="settings-cat-inuse">{t('categoryInUse')}</span>}
                  <button
                    className="settings-cat-del"
                    disabled={inUse}
                    title={inUse ? t('categoryCannotDelete') : t('categoryDelete')}
                    onClick={() => handleDelete(cat.id)}
                  >✕</button>
                </div>
              )
            })}
          </div>

          <div className="settings-cat-add">
            <div className="settings-cat-add-row">
              <input
                className="input input-sm"
                placeholder={t('categoryNewPlaceholder')}
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                maxLength={30}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                className="btn btn-filled"
                style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem', flexShrink: 0 }}
                disabled={!newLabel.trim()}
                onClick={handleAdd}
              >{tc('add')}</button>
            </div>
            <div className="settings-palette">
              {COLOR_PALETTE.map(c => (
                <button
                  key={c}
                  className={`settings-swatch ${newColor === c ? 'selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setNewColor(c)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── You ───────────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">{t('youLabel')}</div>
          <div className="settings-you-row">
            <span className="settings-you-label">{t('birthday')}</span>
            <input
              type="date"
              className="settings-birthday-input"
              value={birthday}
              max={(() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}` })()}
              onChange={e => onBirthdayChange(e.target.value)}
            />
          </div>
        </div>

        {/* ── Cloud sync ────────────────────────────────────────────────── */}
        {(onOpenCloudSync || onOpenAutoBackup) && (
          <div className="settings-section">
            <div className="settings-label">{t('cloudLabel')}</div>
            <div className="settings-backup-row">
              {onOpenCloudSync && (
                <button className="btn"
                  style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
                  onClick={() => { onClose(); onOpenCloudSync() }}>{t('cloudSync')}</button>
              )}
              {onOpenAutoBackup && (
                <button className="btn"
                  style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
                  onClick={() => { onClose(); onOpenAutoBackup() }}>{t('autoBackup')}</button>
              )}
            </div>
          </div>
        )}

        {/* ── Data / backup ─────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">{t('dataLabel')}</div>
          <div className="settings-backup-row">
            <button className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={onExportImage}>{t('exportImage')}</button>
            <button className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={onSaveBackup}>{t('saveBackup')}</button>
            <button className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={() => fileRef.current?.click()}>{t('restoreFromFile')}</button>
            <button className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={() => icsFileRef.current?.click()}>{t('importIcs')}</button>
            <input ref={fileRef} type="file" accept=".json"
              style={{ display: 'none' }} onChange={handleFileChange} />
            <input ref={icsFileRef} type="file" accept=".ics"
              style={{ display: 'none' }} onChange={handleIcsFileChange} />
          </div>
          {persisted === false && (
            <div className="settings-persist-notice">
              <span className="settings-note" style={{ marginTop: 0 }}>
                {t('persistNotice')}
              </span>
              <button
                className="btn"
                style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem', flexShrink: 0 }}
                onClick={handleRequestPersist}
              >{t('persistButton')}</button>
            </div>
          )}
          <p className="settings-note" style={{ marginTop: '0.5rem' }}>
            {t('icsNote')}
          </p>
        </div>

        <IntegrationSettings />

        {onOpenActivityLog && (
          <div className="settings-section">
            <button className="btn" style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={() => { onClose(); onOpenActivityLog() }}>
              {t('activityLog')}
            </button>
            <p className="settings-note" style={{ marginTop: '0.4rem' }}>
              <Trans ns="settings" i18nKey="activityLogNote" components={{ kbd: <kbd /> }} />
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
