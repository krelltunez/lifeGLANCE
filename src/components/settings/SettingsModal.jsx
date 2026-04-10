import React, { useRef, useState } from 'react'
import { saveCategories } from '../../utils/colors'

const TEXT_SIZES = { small: true, normal: true, big: true, bigger: true }

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
  milestones,
  onSaveBackup, onRestoreFile,
  onClose,
}) {
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState(COLOR_PALETTE[0])
  const fileRef = useRef(null)

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
          <div className="zoom-tabs">
            {Object.keys(TEXT_SIZES).map(s => (
              <button key={s}
                className={`zoom-tab ${textSize === s ? 'active' : ''}`}
                onClick={() => onTextSizeChange(s)}>{s}</button>
            ))}
          </div>
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

        {/* ── Display ───────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">display</div>
          <label className="settings-toggle-row">
            <span className="settings-toggle-label">auto-cluster nearby milestones</span>
            <input type="checkbox" className="settings-toggle"
              checked={clustering}
              onChange={e => onClusteringChange(e.target.checked)} />
          </label>
        </div>

        {/* ── Data / backup ─────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">data</div>
          <div className="settings-backup-row">
            <button className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={onSaveBackup}>save backup</button>
            <button className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={() => fileRef.current?.click()}>restore from file</button>
            <input ref={fileRef} type="file" accept=".json"
              style={{ display: 'none' }} onChange={handleFileChange} />
          </div>
        </div>
      </div>
    </div>
  )
}
