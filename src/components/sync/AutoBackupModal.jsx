import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getSyncEngine } from '../../sync/engine'

const FREQUENCIES = [
  { value: 'hourly',  label: 'Hourly (keep 24)' },
  { value: 'daily',   label: 'Daily (keep 30)' },
  { value: 'weekly',  label: 'Weekly (keep 12)' },
]

const BACKUP_CONFIG_KEY = 'lifeglance-auto-backup-config'

function loadBackupConfig() {
  try { return JSON.parse(localStorage.getItem(BACKUP_CONFIG_KEY) || 'null') } catch { return null }
}

function SettingsTab({ onClose }) {
  const { t } = useTranslation('sync')
  const { t: tc } = useTranslation('common')
  const engine = getSyncEngine()
  const existingConfig = engine?.getConfig() ?? null
  const savedBackupConfig = loadBackupConfig()

  const [remoteEnabled, setRemoteEnabled] = useState(savedBackupConfig?.remoteEnabled ?? false)
  const [provider,      setProvider]      = useState(existingConfig?.provider ?? 'nextcloud')
  const [url,           setUrl]           = useState(existingConfig?.url ?? '')
  const [username,      setUsername]      = useState(existingConfig?.username ?? '')
  const [password,      setPassword]      = useState(existingConfig?.password ?? '')
  const [frequency,     setFrequency]     = useState(savedBackupConfig?.frequency ?? 'daily')
  const [testing,       setTesting]       = useState(false)
  const [backingUp,     setBackingUp]     = useState(false)
  const [result,        setResult]        = useState(null)

  function handleSave() {
    localStorage.setItem(BACKUP_CONFIG_KEY, JSON.stringify({ remoteEnabled, frequency }))
    setResult({ ok: true, message: t('settingsSaved') })
    setTimeout(() => { setResult(null); onClose() }, 1200)
  }

  async function handleTest() {
    setTesting(true)
    setResult(null)
    try {
      const config = { provider, url, username, password }
      const ok = await engine?.testConnection?.(config)
      setResult(ok
        ? { ok: true, message: t('connectionSuccessful') }
        : { ok: false, message: t('connectionFailedSimple') })
    } catch (err) {
      setResult({ ok: false, message: t('error', { message: err.message }) })
    } finally {
      setTesting(false)
    }
  }

  async function handleBackupNow() {
    setBackingUp(true)
    setResult(null)
    try {
      await engine?.runBackup(frequency)
      setResult({ ok: true, message: t('backupComplete') })
    } catch (err) {
      setResult({ ok: false, message: t('backupFailed', { message: err.message }) })
    } finally {
      setBackingUp(false)
    }
  }

  const syncConfigured = !!existingConfig?.enabled

  return (
    <div>
      {!syncConfigured && (
        <div style={{
          padding: '0.6rem 1rem',
          borderRadius: '6px',
          marginBottom: '0.75rem',
          fontSize: '0.82rem',
          background: 'var(--amber-bg)',
          color: 'var(--amber-bright)',
        }}>
          {t('cloudSyncRequired')}
        </div>
      )}

      {/* Remote backups */}
      <div className="settings-section">
        <div className="settings-label">{t('remoteBackupsLabel')}</div>
        <label className="settings-toggle-row">
          <span className="settings-toggle-label">{t('enableRemoteBackups')}</span>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={remoteEnabled}
            onChange={e => setRemoteEnabled(e.target.checked)}
            disabled={!syncConfigured}
          />
        </label>

        {remoteEnabled && (
          <>
            <div style={{ marginTop: '0.75rem' }}>
              <div className="settings-label">{t('serverUrlLabel')}</div>
              <input
                className="input"
                type="url"
                placeholder={t('nextcloudPlaceholder')}
                value={url}
                onChange={e => setUrl(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <div className="settings-label">{t('usernameLabel')}</div>
              <input
                className="input"
                type="text"
                placeholder={t('usernamePlaceholder')}
                value={username}
                onChange={e => setUsername(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <div className="settings-label">{t('passwordLabel')}</div>
              <input
                className="input"
                type="password"
                placeholder="app password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <div className="settings-label">{t('frequencyLabel')}</div>
              <select
                className="input"
                value={frequency}
                onChange={e => setFrequency(e.target.value)}
                style={{ width: '100%' }}
              >
                {FREQUENCIES.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {!remoteEnabled && syncConfigured && (
          <div style={{ marginTop: '0.75rem' }}>
            <div className="settings-label">{t('frequencyLabel')}</div>
            <select
              className="input"
              value={frequency}
              onChange={e => setFrequency(e.target.value)}
              style={{ width: '100%' }}
            >
              {FREQUENCIES.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {result && (
        <div style={{
          padding: '0.6rem 1rem',
          borderRadius: '6px',
          marginTop: '0.75rem',
          fontSize: '0.82rem',
          background: result.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
          color: result.ok ? 'var(--success)' : 'var(--rose)',
        }}>
          {result.message}
        </div>
      )}

      <div className="settings-backup-row" style={{ marginTop: '0.75rem', gap: '0.5rem', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {remoteEnabled && (
            <button
              className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={handleTest}
              disabled={testing || !url || !username}
            >
              {testing ? t('testing') : t('testConnection')}
            </button>
          )}
          {syncConfigured && (
            <button
              className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={handleBackupNow}
              disabled={backingUp}
            >
              {backingUp ? t('backingUp') : t('backupNow')}
            </button>
          )}
        </div>
        <button
          className="btn btn-filled"
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
          onClick={handleSave}
        >
          {tc('save')}
        </button>
      </div>

      <p className="settings-note" style={{ marginTop: '0.75rem' }}>
        {t('backupNote')}
      </p>
    </div>
  )
}

function HistoryTab() {
  const { t, i18n } = useTranslation('sync')
  const { t: tc } = useTranslation('common')
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const engine = getSyncEngine()
        const backups = await engine?.autoBackupDB?.listBackups?.() ?? []
        setRecords(backups)
      } catch {
        setRecords([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return <p className="settings-note">{tc('loading')}</p>
  }

  if (records.length === 0) {
    return <p className="settings-note">{t('noBackupsYet')}</p>
  }

  return (
    <div>
      {records.map((r, i) => (
        <div key={i} style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0.5rem 0',
          borderBottom: '1px solid rgba(var(--hilite-rgb), 0.06)',
          fontSize: '0.82rem',
        }}>
          <span style={{ opacity: 0.7 }}>{r.frequency ?? 'backup'}</span>
          <span>{new Date(r.timestamp).toLocaleString(i18n.language)}</span>
        </div>
      ))}
    </div>
  )
}

export default function AutoBackupModal({ onClose }) {
  const { t } = useTranslation('sync')
  const { t: tc } = useTranslation('common')

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])


  const [tab, setTab] = useState('settings')

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet settings-sheet">
        <div className="sheet-header">
          <span className="sheet-title">{t('autoBackupTitle')}</span>
          <button className="sheet-close" onClick={onClose}>&#x2715;</button>
        </div>

        {/* Tabs */}
        <div className="zoom-tabs" style={{ marginBottom: '1rem' }}>
          <button
            className={`zoom-tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            {tc('settings')}
          </button>
          <button
            className={`zoom-tab ${tab === 'history' ? 'active' : ''}`}
            onClick={() => setTab('history')}
          >
            {t('historyTab')}
          </button>
        </div>

        {tab === 'settings' ? <SettingsTab onClose={onClose} /> : <HistoryTab />}
      </div>
    </div>
  )
}
