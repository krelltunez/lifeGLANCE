import React, { useRef, useState } from 'react'
import { saveCategories } from '../../utils/colors'
import { isMuted, setMuted } from '../../utils/audio'

const TEXT_SIZES_ALL = ['small', 'normal', 'big', 'bigger']

const COLOR_PALETTE = [
  '#9370DB', '#A78BFA', '#6366F1', '#3D3580',
  '#4A90D9', '#60A5FA', '#38B2AC', '#34D399',
  '#5CAD6E', '#C8A96E', '#FB923C', '#D4A800',
  '#E85D75', '#F472B6', '#E879F9', '#F87171',
]

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function SettingsModal({
  textSize, onTextSizeChange,
  categories, onCategoriesChange,
  clustering, onClusteringChange,
  birthday, onBirthdayChange,
  milestones,
  onExportImage, onSaveBackup, onRestoreFile, onImportIcsFile,
  onClose,
  ultraCompact = false,
}) {
  const [newLabel,  setNewLabel]  = useState('')
  const [newColor,  setNewColor]  = useState(COLOR_PALETTE[0])
  const [soundOn,   setSoundOn]   = useState(() => !isMuted())
  const fileRef    = useRef(null)
  const icsFileRef = useRef(null)

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
          <span className="sheet-title">settings</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Text size ─────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">text size</div>
          {ultraCompact ? (
            <div className="settings-note">text size adjustment unavailable on short screens</div>
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
          <div className="settings-label">display</div>
          <label className="settings-toggle-row">
            <span className="settings-toggle-label">auto-cluster nearby milestones</span>
            <input type="checkbox" className="settings-toggle"
              checked={clustering}
              onChange={e => onClusteringChange(e.target.checked)} />
          </label>
          <label className="settings-toggle-row">
            <span className="settings-toggle-label">sound effects</span>
            <input type="checkbox" className="settings-toggle"
              checked={soundOn}
              onChange={e => { setSoundOn(e.target.checked); setMuted(!e.target.checked) }} />
          </label>
        </div>

        {/* ── Categories ────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">categories</div>

          <div className="settings-cat-list">
            {categories.map(cat => {
              const inUse = usedIds.has(cat.id)
              return (
                <div key={cat.id} className="settings-cat-row">
                  <div className="settings-cat-dot" style={{ background: cat.color }} />
                  <span className="settings-cat-name">{cat.label}</span>
                  {inUse && <span className="settings-cat-inuse">in use</span>}
                  <button
                    className="settings-cat-del"
                    disabled={inUse}
                    title={inUse ? 'cannot delete — category is in use' : 'delete category'}
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
                placeholder="new category name"
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
              >add</button>
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
          <div className="settings-label">you</div>
          <div className="settings-you-row">
            <span className="settings-you-label">birthday</span>
            <input
              type="date"
              className="settings-birthday-input"
              value={birthday}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => onBirthdayChange(e.target.value)}
            />
          </div>
        </div>

        {/* ── Data / backup ─────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">data</div>
          <div className="settings-backup-row">
            <button className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={onExportImage}>export image</button>
            <button className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={onSaveBackup}>save backup</button>
            <button className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={() => fileRef.current?.click()}>restore from file</button>
            <button className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={() => icsFileRef.current?.click()}>import .ics</button>
            <input ref={fileRef} type="file" accept=".json"
              style={{ display: 'none' }} onChange={handleFileChange} />
            <input ref={icsFileRef} type="file" accept=".ics"
              style={{ display: 'none' }} onChange={handleIcsFileChange} />
          </div>
          <p className="settings-note" style={{ marginTop: '0.5rem' }}>
            .ics import supports all-day events only. Timed events are skipped — the import dialog shows a count of how many were omitted.
          </p>
        </div>
      </div>
    </div>
  )
}
