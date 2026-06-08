import React, { useState, useEffect } from 'react'
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
    setResult({ ok: true, message: 'Settings saved.' })
    setTimeout(() => { setResult(null); onClose() }, 1200)
  }

  async function handleTest() {
    setTesting(true)
    setResult(null)
    try {
      const config = { provider, url, username, password }
      const ok = await engine?.testConnection?.(config)
      setResult(ok
        ? { ok: true, message: 'Connection successful.' }
        : { ok: false, message: 'Connection failed.' })
    } catch (err) {
      setResult({ ok: false, message: `Error: ${err.message}` })
    } finally {
      setTesting(false)
    }
  }

  async function handleBackupNow() {
    setBackingUp(true)
    setResult(null)
    try {
      await engine?.runBackup(frequency)
      setResult({ ok: true, message: 'Backup complete.' })
    } catch (err) {
      setResult({ ok: false, message: `Backup failed: ${err.message}` })
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
          background: '#2a1f10',
          color: '#D4A800',
        }}>
          Cloud Sync must be configured first. Auto-backup uploads to the same server.
        </div>
      )}

      {/* Remote backups */}
      <div className="settings-section">
        <div className="settings-label">remote backups</div>
        <label className="settings-toggle-row">
          <span className="settings-toggle-label">enable automatic remote backups</span>
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
              <div className="settings-label">server url</div>
              <input
                className="input"
                type="url"
                placeholder="https://your-nextcloud.example.com"
                value={url}
                onChange={e => setUrl(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <div className="settings-label">username</div>
              <input
                className="input"
                type="text"
                placeholder="your username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <div className="settings-label">password</div>
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
              <div className="settings-label">frequency</div>
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
            <div className="settings-label">frequency</div>
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
          background: result.ok ? '#0f2a1a' : '#2a1010',
          color: result.ok ? '#34D399' : '#E85D75',
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
              {testing ? 'testing...' : 'test connection'}
            </button>
          )}
          {syncConfigured && (
            <button
              className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={handleBackupNow}
              disabled={backingUp}
            >
              {backingUp ? 'backing up...' : 'backup now'}
            </button>
          )}
        </div>
        <button
          className="btn btn-filled"
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
          onClick={handleSave}
        >
          save
        </button>
      </div>

      <p className="settings-note" style={{ marginTop: '0.75rem' }}>
        Only enable on one device. If you use multiple devices, use Cloud Sync to keep them in sync and set up remote backups on your primary device only.
      </p>
    </div>
  )
}

function HistoryTab() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load backup records from the engine's backup IndexedDB
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
    return <p className="settings-note">Loading...</p>
  }

  if (records.length === 0) {
    return <p className="settings-note">No backups yet.</p>
  }

  return (
    <div>
      {records.map((r, i) => (
        <div key={i} style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0.5rem 0',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          fontSize: '0.82rem',
        }}>
          <span style={{ opacity: 0.7 }}>{r.frequency ?? 'backup'}</span>
          <span>{new Date(r.timestamp).toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

export default function AutoBackupModal({ onClose }) {
  const [tab, setTab] = useState('settings')

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet settings-sheet">
        <div className="sheet-header">
          <span className="sheet-title">auto-backup</span>
          <button className="sheet-close" onClick={onClose}>&#x2715;</button>
        </div>

        {/* Tabs */}
        <div className="zoom-tabs" style={{ marginBottom: '1rem' }}>
          <button
            className={`zoom-tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            settings
          </button>
          <button
            className={`zoom-tab ${tab === 'history' ? 'active' : ''}`}
            onClick={() => setTab('history')}
          >
            history
          </button>
        </div>

        {tab === 'settings' ? <SettingsTab onClose={onClose} /> : <HistoryTab />}
      </div>
    </div>
  )
}
