import React, { useState, useEffect } from 'react'
import { getSyncEngine } from '../../sync/engine'

const PROXY = '/api/webdav-proxy'

// Recursively MKCOL a directory path, creating parents as needed.
// Tolerates 405 (already exists) and 201 (created) as success.
async function mkdirp(url, username, password) {
  const auth = username ? { Authorization: 'Basic ' + btoa(`${username}:${password}`) } : {}
  const res = await fetch(PROXY, { method: 'MKCOL', headers: { ...auth, 'X-WebDAV-Url': url } })
  if (res.status === 201 || res.status === 405) return           // created or already exists
  if (res.status === 403 || res.status === 409 || res.status === 404) {
    const parent = url.replace(/\/+$/, '').replace(/\/[^/]+$/, '/')
    if (parent && parent !== url) {
      await mkdirp(parent, username, password)
      await fetch(PROXY, { method: 'MKCOL', headers: { ...auth, 'X-WebDAV-Url': url } })
    }
  }
}

// Resolves the full WebDAV base URL for the given provider/username combo.
// For Nextcloud, appends /remote.php/dav/files/{username}/ if not already present.
function resolveWebdavBase(provider, url, username) {
  const base = url.replace(/\/+$/, '')
  if (provider === 'nextcloud' && !base.includes('/remote.php/dav')) {
    return `${base}/remote.php/dav/files/${encodeURIComponent(username)}`
  }
  return base
}

const PROVIDERS = [
  { value: 'nextcloud', label: 'Nextcloud / WebDAV' },
  { value: 'koofr',     label: 'Koofr' },
  { value: 'webdav',    label: 'Generic WebDAV' },
]

function SyncDot({ syncStatus, syncError, syncHalted }) {
  const color = syncHalted || syncError
    ? '#E85D75'
    : syncStatus === 'syncing'
      ? '#D4A800'
      : '#34D399'
  return (
    <span
      className="sync-dot"
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        marginRight: '6px',
        background: color,
        flexShrink: 0,
      }}
    />
  )
}

export default function CloudSyncModal({ syncStatus, syncError, syncHalted, lastSynced, onClose }) {
  const engine = getSyncEngine()
  const existingConfig = engine?.getConfig() ?? null

  const [provider,    setProvider]    = useState(existingConfig?.provider ?? 'nextcloud')
  const [url,         setUrl]         = useState(existingConfig?.url ?? '')
  const [username,    setUsername]    = useState(existingConfig?.username ?? '')
  const [password,    setPassword]    = useState(existingConfig?.password ?? '')
  const [folder,      setFolder]      = useState(existingConfig?.folder ?? 'GLANCE/lifeglance')
  const [encrypt,     setEncrypt]     = useState(existingConfig?.encrypt ?? false)
  const [passphrase,  setPassphrase]  = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [testing,     setTesting]     = useState(false)
  const [testResult,  setTestResult]  = useState(null) // null | { ok, message }
  const [saving,      setSaving]      = useState(false)

  const isExisting = !!existingConfig

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      // Build a temporary config to test
      const webdavBase = resolveWebdavBase(provider, url, username)
      const config = { provider, url, username, password, folder, enabled: true,
        webdavUrl: webdavBase, nextcloudUrl: url, appPassword: password }
      const result = await engine?.test?.(config)
      if (!result) throw new Error('Sync engine not initialized.')
      setTestResult(result.success
        ? { ok: true, message: 'Connection successful.' }
        : { ok: false, message: result.error ?? 'Connection failed. Check your credentials and URL.' })
    } catch (err) {
      setTestResult({ ok: false, message: `Connection failed: ${err.message}` })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    if (!isExisting && encrypt && !passphrase) return
    if (!isExisting && encrypt && passphrase !== confirmPass) {
      setTestResult({ ok: false, message: 'Passphrases do not match.' })
      return
    }
    setSaving(true)
    try {
      const webdavBase = resolveWebdavBase(provider, url, username)
      const baseConfig = {
        provider, url, username, password, folder, encrypt, enabled: true,
        webdavUrl: webdavBase, nextcloudUrl: url, appPassword: password,
      }
      const dirUrl = `${webdavBase}/${folder}/`
      await mkdirp(dirUrl, username, password)

      if (encrypt) {
        const cryptoConfig = { cryptoDBName: 'lifeglance-crypto' }
        if (passphrase) {
          const { setupEncryptionKey } = await import('@glance-apps/sync')
          await setupEncryptionKey(passphrase, cryptoConfig)
        } else {
          const { initSessionKey } = await import('@glance-apps/sync')
          const ok = await initSessionKey(cryptoConfig)
          if (!ok) {
            setTestResult({ ok: false, message: 'Enter your passphrase to activate encryption.' })
            setSaving(false)
            return
          }
        }
        // Key is loaded — persist config with encryptionEnabled and immediately
        // upload so the plaintext file on the server is overwritten encrypted.
        engine?.setConfig({ ...baseConfig, encryptionEnabled: true })
        await engine?.upload()
      } else {
        const { clearEncryptionKey } = await import('@glance-apps/sync')
        await clearEncryptionKey({ cryptoDBName: 'lifeglance-crypto' })
        engine?.setConfig({ ...baseConfig, encryptionEnabled: false })
        engine?.upload().catch(console.error)
      }
      onClose()
    } catch (err) {
      console.error('[sync] save failed:', err)
      setTestResult({ ok: false, message: `Save failed: ${err.message}` })
    } finally {
      setSaving(false)
    }
  }

  async function handleDisable() {
    engine?.setConfig(null)
    onClose()
  }

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet settings-sheet">
        <div className="sheet-header">
          <span className="sheet-title" style={{ display: 'flex', alignItems: 'center' }}>
            <SyncDot syncStatus={syncStatus} syncError={syncError} syncHalted={syncHalted} />
            cloud sync
          </span>
          <button className="sheet-close" onClick={onClose}>&#x2715;</button>
        </div>

        {/* Hard-stop error banner */}
        {syncHalted && syncError && (
          <div style={{
            background: '#3a1a1a',
            border: '1px solid #E85D75',
            borderRadius: '6px',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            color: '#E85D75',
            fontSize: '0.82rem',
          }}>
            <strong>Sync halted:</strong> {syncError.message}
            {syncError.code && <span style={{ opacity: 0.7, marginLeft: '0.5rem' }}>[{syncError.code}]</span>}
          </div>
        )}

        {/* Non-hard-stop error */}
        {syncError && !syncHalted && (
          <div style={{
            background: '#2a1a1a',
            border: '1px solid #E85D7588',
            borderRadius: '6px',
            padding: '0.6rem 1rem',
            marginBottom: '0.75rem',
            color: '#E85D75',
            fontSize: '0.8rem',
          }}>
            {syncError.message}
          </div>
        )}

        {/* Provider */}
        <div className="settings-section">
          <div className="settings-label">provider</div>
          <select
            className="input"
            value={provider}
            onChange={e => setProvider(e.target.value)}
            style={{ width: '100%' }}
          >
            {PROVIDERS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* URL */}
        <div className="settings-section">
          <div className="settings-label">server url</div>
          <input
            className="input"
            type="url"
            placeholder={provider === 'koofr' ? 'https://app.koofr.net (auto-filled)' : 'https://your-nextcloud.example.com'}
            value={url}
            onChange={e => setUrl(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        {/* Username */}
        <div className="settings-section">
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

        {/* App Password */}
        <div className="settings-section">
          <div className="settings-label">app password</div>
          <input
            className="input"
            type="password"
            placeholder="app-specific password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        {/* Sync folder */}
        <div className="settings-section">
          <div className="settings-label">sync folder</div>
          <input
            className="input"
            type="text"
            placeholder="GLANCE/lifeglance"
            value={folder}
            onChange={e => setFolder(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        {/* Encryption */}
        <div className="settings-section">
          <div className="settings-label">encryption</div>
          <label className="settings-toggle-row">
            <span className="settings-toggle-label">encrypt sync data</span>
            <input
              type="checkbox"
              className="settings-toggle"
              checked={encrypt}
              onChange={e => setEncrypt(e.target.checked)}
            />
          </label>

          {encrypt && isExisting && (
            <p className="settings-note" style={{ color: '#D4A800', marginTop: '0.5rem' }}>
              Encryption already configured. Leave passphrase blank to keep existing key, or re-enter to re-authenticate on this device.
            </p>
          )}

          {encrypt && (
            <>
              <div style={{ marginTop: '0.75rem' }}>
                <div className="settings-label">passphrase</div>
                <input
                  className="input"
                  type="password"
                  placeholder={isExisting ? '(leave blank to keep existing)' : 'enter passphrase'}
                  value={passphrase}
                  onChange={e => setPassphrase(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              {!isExisting && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div className="settings-label">confirm passphrase</div>
                  <input
                    className="input"
                    type="password"
                    placeholder="confirm passphrase"
                    value={confirmPass}
                    onChange={e => setConfirmPass(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div style={{
            padding: '0.6rem 1rem',
            borderRadius: '6px',
            marginBottom: '0.75rem',
            fontSize: '0.82rem',
            background: testResult.ok ? '#0f2a1a' : '#2a1010',
            color: testResult.ok ? '#34D399' : '#E85D75',
            border: `1px solid ${testResult.ok ? '#34D39944' : '#E85D7544'}`,
          }}>
            {testResult.message}
          </div>
        )}

        {/* Last synced */}
        {lastSynced && (
          <p className="settings-note" style={{ marginBottom: '0.75rem' }}>
            last synced: {new Date(lastSynced).toLocaleString()}
          </p>
        )}

        {/* Actions */}
        <div className="settings-backup-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button
            className="btn"
            style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
            onClick={handleTest}
            disabled={testing || !url || !username}
          >
            {testing ? 'testing...' : 'test connection'}
          </button>

          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
            <button
              className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={onClose}
            >
              cancel
            </button>
            {isExisting && (
              <button
                className="btn btn-danger"
                style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
                onClick={handleDisable}
              >
                disable
              </button>
            )}
            <button
              className="btn btn-filled"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={handleSave}
              disabled={saving || !url || !username || !password}
            >
              {saving ? 'saving...' : isExisting ? 'save' : 'save & enable'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
