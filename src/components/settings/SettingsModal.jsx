import React, { useRef, useState, useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { saveCategories } from '../../utils/colors'
import { isMuted, setMuted } from '../../utils/audio'
import { THEMES, getTheme, setTheme } from '../../utils/theme'
import { dateFieldOrder, monthNames } from '../../utils/dates'
import IntegrationSettings from '../dayglance/IntegrationSettings'

const TEXT_SIZES_ALL = ['small', 'normal', 'big', 'bigger']
const TEXT_SIZE_LABELS = {
  small: 'textSizeSmall', normal: 'textSizeNormal', big: 'textSizeBig', bigger: 'textSizeBigger',
}

const COLOR_PALETTE = [
  'var(--purple)', 'var(--cat-violet)', 'var(--cat-indigo)', 'var(--indigo)',
  'var(--accent-blue)', 'var(--cat-blue)', 'var(--teal)', 'var(--success)',
  'var(--success-muted)', 'var(--amber)', 'var(--cat-orange)', 'var(--amber-bright)',
  'var(--rose)', 'var(--cat-pink)', 'var(--cat-magenta)', 'var(--cat-red)',
]

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Number of days in a given 1-based month, defaulting to 31 until a month is
// picked so the day list is never empty.
function daysInMonth(year, month) {
  if (!month) return 31
  return new Date(Number(year) || 2000, Number(month), 0).getDate()
}

// Birthday entry as three Year / Month / Day dropdowns instead of a native
// <input type="date">. On phones the native picker opens a calendar that forces
// tapping back through a month per step to reach a birth year decades ago
// (issue #243); dropdowns make it a few taps. The stored value keeps the exact
// same YYYY-MM-DD string the date input produced, so age math and sync are
// unchanged. Fields are ordered per locale (dateFieldOrder).
function BirthdayPicker({ value, onChange, language, tc }) {
  const months = monthNames(language, 'long')

  const parse = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '')
    return m ? { y: m[1], mo: String(Number(m[2])), d: String(Number(m[3])) } : { y: '', mo: '', d: '' }
  }
  const [parts, setParts] = useState(() => parse(value))

  // Re-sync if the birthday changes elsewhere (e.g. restored from a backup or a
  // GLANCEvault sync) while this modal is open. Adjusting state during render off
  // the previous prop is React's recommended alternative to a syncing effect.
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setParts(parse(value))
  }

  const nowYear = new Date().getFullYear()
  const years = Array.from({ length: nowYear - 1900 + 1 }, (_, i) => String(nowYear - i))
  const days = Array.from({ length: daysInMonth(parts.y, parts.mo) }, (_, i) => String(i + 1))

  function update(next) {
    // Keep the day valid for the chosen month/year (e.g. Feb 31 -> Feb 28/29).
    const max = daysInMonth(next.y, next.mo)
    if (next.d && Number(next.d) > max) next.d = String(max)
    setParts(next)
    // Only emit a complete date; an incomplete selection clears the birthday.
    onChange(next.y && next.mo && next.d
      ? `${next.y}-${next.mo.padStart(2, '0')}-${next.d.padStart(2, '0')}`
      : '')
  }

  const fields = {
    year: (
      <select key="year" className="settings-birthday-input" value={parts.y}
        onChange={e => update({ ...parts, y: e.target.value })} aria-label={tc('year')}>
        <option value="">{tc('year')}</option>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    ),
    month: (
      <select key="month" className="settings-birthday-input" value={parts.mo}
        onChange={e => update({ ...parts, mo: e.target.value })} aria-label={tc('month')}>
        <option value="">{tc('month')}</option>
        {months.map((m, i) => <option key={i + 1} value={String(i + 1)}>{m}</option>)}
      </select>
    ),
    day: (
      <select key="day" className="settings-birthday-input" value={parts.d}
        onChange={e => update({ ...parts, d: e.target.value })} aria-label={tc('day')}>
        <option value="">{tc('day')}</option>
        {days.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    ),
  }

  return (
    <div className="settings-birthday-fields">
      {dateFieldOrder(language).map(f => fields[f])}
    </div>
  )
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
  onOpenSubscription,
  onOpenActivityLog,
  onClose,
  ultraCompact = false,
}) {
  const { t, i18n } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const { t: tb } = useTranslation('billing')
  const [newLabel,   setNewLabel]   = useState('')
  const [newColor,   setNewColor]   = useState(COLOR_PALETTE[0])
  const [editingId,  setEditingId]  = useState(null)
  const [editLabel,  setEditLabel]  = useState('')
  const [editColor,  setEditColor]  = useState(COLOR_PALETTE[0])
  const [soundOn,    setSoundOn]    = useState(() => !isMuted())
  const [theme,      setThemeState] = useState(getTheme)
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

  function startEdit(cat) {
    setEditingId(cat.id)
    setEditLabel(cat.label)
    setEditColor(cat.color)
  }

  function saveEdit() {
    const label = editLabel.trim()
    if (!label) return
    // Categories are referenced by id, so renaming/recoloring updates every
    // milestone automatically — no need to re-categorize.
    const updated = categories.map(c =>
      c.id === editingId ? { ...c, label: label.toLowerCase(), color: editColor } : c
    )
    saveCategories(updated)
    onCategoriesChange(updated)
    setEditingId(null)
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
                  onClick={() => onTextSizeChange(s)}>{t(TEXT_SIZE_LABELS[s])}</button>
              ))}
            </div>
          )}
        </div>

        {/* ── Display ───────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">{t('displayLabel')}</div>
          <div className="settings-idle-timeout">
            <span className="settings-toggle-label">{t('themeLabel')}</span>
            <div className="zoom-tabs">
              {THEMES.map(m => (
                <button key={m}
                  className={`zoom-tab ${theme === m ? 'active' : ''}`}
                  onClick={() => setThemeState(setTheme(m))}>{t(`theme_${m}`)}</button>
              ))}
            </div>
          </div>
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
                        onClick={() => onIdleTimeoutChange(opt.ms)}>{tc('minutesShort', { m: opt.ms / 60000 })}</button>
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
              if (editingId === cat.id) {
                return (
                  <div key={cat.id} className="settings-cat-add settings-cat-edit-block">
                    <div className="settings-cat-add-row">
                      <input
                        className="input input-sm"
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit() }}
                        maxLength={30}
                        autoFocus
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <button
                        className="btn btn-filled"
                        style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem', flexShrink: 0 }}
                        disabled={!editLabel.trim()}
                        onClick={saveEdit}
                      >{tc('save')}</button>
                      <button
                        className="btn"
                        style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem', flexShrink: 0 }}
                        onClick={() => setEditingId(null)}
                      >{tc('cancel')}</button>
                    </div>
                    <div className="settings-palette">
                      {COLOR_PALETTE.map(c => (
                        <button
                          key={c}
                          className={`settings-swatch ${editColor === c ? 'selected' : ''}`}
                          style={{ background: c }}
                          onClick={() => setEditColor(c)}
                        />
                      ))}
                    </div>
                  </div>
                )
              }
              return (
                <div key={cat.id} className="settings-cat-row">
                  <div className="settings-cat-dot" style={{ background: cat.color }} />
                  <span className="settings-cat-name">{cat.label}</span>
                  {inUse && <span className="settings-cat-inuse">{t('categoryInUse')}</span>}
                  <button
                    className="settings-cat-edit"
                    title={tc('edit')}
                    onClick={() => startEdit(cat)}
                  >✎</button>
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
            <BirthdayPicker
              value={birthday}
              onChange={onBirthdayChange}
              language={i18n.language}
              tc={tc}
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

        {/* ── Subscription (gated Play builds only) ─────────────────────── */}
        {onOpenSubscription && (
          <div className="settings-section">
            <div className="settings-label">{tb('title')}</div>
            <div className="settings-backup-row">
              <button className="btn"
                style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
                onClick={() => { onClose(); onOpenSubscription() }}>{tb('manage')}</button>
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
