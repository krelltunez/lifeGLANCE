import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { getSyncEngine } from '../../sync/engine'
import { isSyncing, syncErrorText, SYNC_ERROR_I18N_KEYS } from '../../sync/status'
import { verifyVaultCredentials, runVaultSetup, disableVault, VAULT_OUTCOME } from '../../sync/vaultSetup'
import { runMediaBackfill } from '../../blobs/mediaBackfill'

// Maps a vault verify/setup outcome kind to its distinct, translatable message.
const VAULT_MSG_KEY = {
  [VAULT_OUTCOME.SUCCESS]:       'vaultOk',
  [VAULT_OUTCOME.UNINITIALIZED]: 'vaultUninitialized',
  [VAULT_OUTCOME.AUTH]:          'vaultAuth',
  [VAULT_OUTCOME.FORBIDDEN]:     'vaultForbidden',
  [VAULT_OUTCOME.NETWORK]:       'vaultNetwork',
  [VAULT_OUTCOME.UNSUPPORTED]:   'vaultUnsupported',
  passphrase:                    'vaultPassphraseRequired',
}

const PROXY = '/api/webdav-proxy'

async function mkdirp(url, username, password) {
  const auth = username ? { Authorization: 'Basic ' + btoa(`${username}:${password}`) } : {}
  const res = await fetch(PROXY, { method: 'MKCOL', headers: { ...auth, 'X-WebDAV-Url': url } })
  if (res.status === 201 || res.status === 405) return
  if (res.status === 403 || res.status === 409 || res.status === 404) {
    const parent = url.replace(/\/+$/, '').replace(/\/[^/]+$/, '/')
    if (parent && parent !== url) {
      await mkdirp(parent, username, password)
      await fetch(PROXY, { method: 'MKCOL', headers: { ...auth, 'X-WebDAV-Url': url } })
    }
  }
}

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
    ? 'var(--rose)'
    : isSyncing(syncStatus)
      ? 'var(--amber-bright)'
      : 'var(--success)'
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

export default function CloudSyncModal({ syncStatus, syncError, syncHalted, lastSynced, vaultSkipped, onClose }) {
  const { t, i18n } = useTranslation('sync')
  const { t: tc } = useTranslation('common')
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
  const [testResult,  setTestResult]  = useState(null)
  const [saving,      setSaving]      = useState(false)

  // ── Vault (GLANCEvault database) tier — coexists with WebDAV above ──────────
  const [vaultEnabled,    setVaultEnabled]    = useState(existingConfig?.vaultEnabled ?? false)
  const [vaultUrl,        setVaultUrl]        = useState(existingConfig?.vaultUrl ?? '')
  const [vaultToken,      setVaultToken]      = useState(existingConfig?.vaultToken ?? '')
  const [accountId,       setAccountId]       = useState(existingConfig?.accountId ?? '')
  const [vaultPassphrase, setVaultPassphrase] = useState('')
  const [vaultTesting,    setVaultTesting]    = useState(false)
  const [vaultSaving,     setVaultSaving]     = useState(false)
  const [vaultResult,     setVaultResult]     = useState(null)
  const vaultConfigured = !!existingConfig?.vaultEnabled

  // ── Backfill: upload existing local-only media to GLANCEvault (user-initiated) ─
  const [backfillRunning,  setBackfillRunning]  = useState(false)
  const [backfillProgress, setBackfillProgress] = useState({ done: 0, total: 0 })
  const [backfillMsg,      setBackfillMsg]      = useState(null) // { ok, message }
  const backfillStopRef = useRef(false)
  // If the modal closes mid-run, signal a cooperative stop so the run halts at the
  // next item boundary. Already-written slots are durable, so a later run resumes.
  useEffect(() => () => { backfillStopRef.current = true }, [])

  const isExisting = !!existingConfig

  // Typed engine error codes (KEY_MISMATCH, VERIFIER_UNSUPPORTED) are surfaced with
  // clear, actionable messages instead of raw crypto/server text. The engine aborts
  // before any upload on KEY_MISMATCH, so the account is never polluted.
  const errorText = syncErrorText(syncError, t)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const webdavBase = resolveWebdavBase(provider, url, username)
      const config = { provider, url, username, password, folder, enabled: true,
        webdavUrl: webdavBase, nextcloudUrl: url, appPassword: password }
      const result = await engine?.test?.(config)
      if (!result) throw new Error('Sync engine not initialized.')
      setTestResult(result.success
        ? { ok: true, message: t('connectionSuccessful') }
        : { ok: false, message: result.error ?? t('connectionFailed') })
    } catch (err) {
      setTestResult({ ok: false, message: t('connectionFailedError', { message: err.message }) })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    if (!isExisting && encrypt && !passphrase) return
    if (!isExisting && encrypt && passphrase !== confirmPass) {
      setTestResult({ ok: false, message: t('passphraseMismatch') })
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
            setTestResult({ ok: false, message: t('enterPassphraseToActivate') })
            setSaving(false)
            return
          }
        }
        // Merge over the live config so the coexisting vault fields are preserved
        // (both tiers share the lifeglance-cloud-sync-config object).
        engine?.setConfig({ ...(engine.getConfig() ?? {}), ...baseConfig, encryptionEnabled: true })
        await engine?.upload()
      } else {
        const { clearEncryptionKey } = await import('@glance-apps/sync')
        await clearEncryptionKey({ cryptoDBName: 'lifeglance-crypto' })
        engine?.setConfig({ ...(engine.getConfig() ?? {}), ...baseConfig, encryptionEnabled: false })
        engine?.upload().catch(console.error)
      }
      onClose()
    } catch (err) {
      console.error('[sync] save failed:', err)
      const mappedKey = SYNC_ERROR_I18N_KEYS[err?.code]
      if (mappedKey) {
        // Wrong passphrase (KEY_MISMATCH) or a server too old for the key verifier
        // (VERIFIER_UNSUPPORTED): the engine verifies/aborts before uploading, so
        // nothing was written remotely. Roll back to the prior config so we don't
        // leave sync half-enabled, and show the clear message instead of raw text.
        try { engine?.setConfig(existingConfig) } catch { /* best-effort rollback */ }
        setTestResult({ ok: false, message: t(mappedKey) })
      } else {
        setTestResult({ ok: false, message: t('saveFailed', { message: err.message }) })
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDisable() {
    // Disabling the WebDAV tier must not wipe a coexisting vault config. If the
    // vault is configured, keep only its fields; otherwise clear the whole object.
    const cfg = engine?.getConfig() ?? {}
    if (cfg.vaultEnabled) {
      engine?.setConfig({ vaultEnabled: cfg.vaultEnabled, vaultUrl: cfg.vaultUrl, vaultToken: cfg.vaultToken, accountId: cfg.accountId })
    } else {
      engine?.setConfig(null)
    }
    onClose()
  }

  // ── Vault handlers ─────────────────────────────────────────────────────────
  const vaultMsg = (kind) => t(VAULT_MSG_KEY[kind] ?? 'vaultNetwork')

  async function handleVaultVerify() {
    setVaultTesting(true)
    setVaultResult(null)
    try {
      const { kind } = await verifyVaultCredentials({ vaultUrl, vaultToken, accountId })
      const ok = kind === VAULT_OUTCOME.SUCCESS || kind === VAULT_OUTCOME.UNINITIALIZED
      setVaultResult({ ok, message: vaultMsg(kind) })
    } finally {
      setVaultTesting(false)
    }
  }

  async function handleVaultSave() {
    setVaultSaving(true)
    setVaultResult(null)
    try {
      // The single sync passphrase: take what was typed here, else whatever is
      // already loaded in this session (e.g. from WebDAV encryption setup).
      const { getSyncPassphrase } = await import('@glance-apps/sync')
      const passphrase = vaultPassphrase || getSyncPassphrase() || ''
      const result = await runVaultSetup({ vaultUrl, vaultToken, accountId, passphrase })
      if (result.ok) {
        // 'uninitialized' shows its own informative message; success shows activated.
        setVaultResult({ ok: true, message: result.kind === VAULT_OUTCOME.UNINITIALIZED ? vaultMsg(result.kind) : t('vaultActivated') })
      } else {
        setVaultResult({ ok: false, message: vaultMsg(result.kind) })
      }
    } catch (err) {
      setVaultResult({ ok: false, message: t('saveFailed', { message: err.message }) })
    } finally {
      setVaultSaving(false)
    }
  }

  function handleVaultDisable() {
    disableVault()
    setVaultEnabled(false)
    setVaultResult(null)
  }

  function backfillSummaryMsg(s) {
    if (s.keyUnavailable) return { ok: false, message: t('backfillKeyUnavailable') }
    if (s.stopped)        return { ok: true,  message: t('backfillStopped', { migrated: s.migrated }) }
    if (s.total === 0)    return { ok: true,  message: t('backfillNothing') }
    if (s.failed > 0)     return { ok: true,  message: t('backfillDoneWithFailures', { migrated: s.migrated, failed: s.failed }) }
    return { ok: true, message: t('backfillDone', { migrated: s.migrated }) }
  }

  async function handleBackfill() {
    setBackfillRunning(true)
    setBackfillMsg(null)
    setBackfillProgress({ done: 0, total: 0 })
    backfillStopRef.current = false
    try {
      const summary = await runMediaBackfill({
        onProgress: (p) => setBackfillProgress(p),
        shouldStop: () => backfillStopRef.current,
      })
      // Any newly-written real-hash slots need the timeline to reload so the media
      // becomes visible immediately (and its updated_at bump has already queued the
      // push to other devices).
      if (summary.migrated > 0) window.dispatchEvent(new Event('lifeglance:milestones-reload'))
      if (summary.failures?.length) console.warn('[media backfill] failed items:', summary.failures)
      setBackfillMsg(backfillSummaryMsg(summary))
    } catch (err) {
      setBackfillMsg({ ok: false, message: t('backfillError', { message: err?.message || String(err) }) })
    } finally {
      setBackfillRunning(false)
    }
  }

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet settings-sheet">
        <div className="sheet-header">
          <span className="sheet-title" style={{ display: 'flex', alignItems: 'center' }}>
            <SyncDot syncStatus={syncStatus} syncError={syncError} syncHalted={syncHalted} />
            {t('title')}
          </span>
          <button className="sheet-close" onClick={onClose}>&#x2715;</button>
        </div>

        {/* Hard-stop error banner */}
        {syncHalted && syncError && (
          <div style={{
            background: 'var(--danger-bg-soft)',
            border: '1px solid var(--rose)',
            borderRadius: '6px',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            color: 'var(--rose)',
            fontSize: '0.82rem',
          }}>
            <strong>{t('syncHalted')}</strong> {errorText}
            {syncError.code && <span style={{ opacity: 0.7, marginLeft: '0.5rem' }}>[{syncError.code}]</span>}
          </div>
        )}

        {/* Non-hard-stop error */}
        {syncError && !syncHalted && (
          <div style={{
            background: 'var(--danger-bg-dim)',
            border: '1px solid rgba(var(--rose-rgb), 0.533)',
            borderRadius: '6px',
            padding: '0.6rem 1rem',
            marginBottom: '0.75rem',
            color: 'var(--rose)',
            fontSize: '0.8rem',
          }}>
            {errorText}
          </div>
        )}

        {/* Per-row quarantine — durable amber note that some rows couldn't be read
            (e.g. a partial key mismatch). Persists after the transient toast dismisses.
            The engine retries quarantined rows automatically on later sync cycles. */}
        {vaultSkipped?.count > 0 && (
          <div style={{
            background: 'var(--danger-bg-dim)',
            border: '1px solid var(--amber-bright)',
            borderRadius: '6px',
            padding: '0.6rem 1rem',
            marginBottom: '0.75rem',
            color: 'var(--amber-bright)',
            fontSize: '0.8rem',
          }}>
            {t('vaultSkippedNote', { count: vaultSkipped.count })}
          </div>
        )}

        {/* Provider */}
        <div className="settings-section">
          <div className="settings-label">{t('providerLabel')}</div>
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
          <div className="settings-label">{t('serverUrlLabel')}</div>
          <input
            className="input"
            type="url"
            placeholder={provider === 'koofr' ? t('koofrPlaceholder') : t('nextcloudPlaceholder')}
            value={url}
            onChange={e => setUrl(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        {/* Username */}
        <div className="settings-section">
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

        {/* App Password */}
        <div className="settings-section">
          <div className="settings-label">{t('appPasswordLabel')}</div>
          <input
            className="input"
            type="password"
            placeholder={t('appPasswordPlaceholder')}
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        {/* Sync folder */}
        <div className="settings-section">
          <div className="settings-label">{t('folderLabel')}</div>
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
          <div className="settings-label">{t('encryptionLabel')}</div>
          <label className="settings-toggle-row">
            <span className="settings-toggle-label">{t('encryptSyncData')}</span>
            <input
              type="checkbox"
              className="settings-toggle"
              checked={encrypt}
              onChange={e => setEncrypt(e.target.checked)}
            />
          </label>

          {encrypt && isExisting && (
            <p className="settings-note" style={{ color: 'var(--amber-bright)', marginTop: '0.5rem' }}>
              {t('encryptionAlreadyConfigured')}
            </p>
          )}

          {encrypt && (
            <>
              <div style={{ marginTop: '0.75rem' }}>
                <div className="settings-label">{t('passphraseLabel')}</div>
                <input
                  className="input"
                  type="password"
                  placeholder={isExisting ? t('passphrasePlaceholderExisting') : t('passphrasePlaceholderNew')}
                  value={passphrase}
                  onChange={e => setPassphrase(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              {!isExisting && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div className="settings-label">{t('confirmPassphraseLabel')}</div>
                  <input
                    className="input"
                    type="password"
                    placeholder={t('confirmPassphraseLabel')}
                    value={confirmPass}
                    onChange={e => setConfirmPass(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* ── GLANCEvault (database) tier — coexists with WebDAV above ─────── */}
        <div className="settings-section" style={{ borderTop: '1px solid var(--border-soft, rgba(128,128,128,0.25))', paddingTop: '0.85rem', marginTop: '0.5rem' }}>
          <div className="settings-label">{t('vaultSectionTitle')}</div>
          <p className="settings-note" style={{ marginTop: '0.15rem', marginBottom: '0.5rem' }}>{t('vaultCoexistNote')}</p>
          <label className="settings-toggle-row">
            <span className="settings-toggle-label">{t('vaultEnableLabel')}</span>
            <input
              type="checkbox"
              className="settings-toggle"
              checked={vaultEnabled}
              onChange={e => { setVaultEnabled(e.target.checked); setVaultResult(null) }}
            />
          </label>

          {vaultEnabled && (
            <>
              <div style={{ marginTop: '0.75rem' }}>
                <div className="settings-label">{t('vaultUrlLabel')}</div>
                <input className="input" type="url" placeholder={t('vaultUrlPlaceholder')}
                  value={vaultUrl} onChange={e => setVaultUrl(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ marginTop: '0.5rem' }}>
                <div className="settings-label">{t('vaultTokenLabel')}</div>
                <input className="input" type="password" placeholder={t('vaultTokenPlaceholder')}
                  value={vaultToken} onChange={e => setVaultToken(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ marginTop: '0.5rem' }}>
                <div className="settings-label">{t('vaultAccountLabel')}</div>
                <input className="input" type="text" placeholder={t('vaultAccountPlaceholder')}
                  value={accountId} onChange={e => setAccountId(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ marginTop: '0.5rem' }}>
                <div className="settings-label">{t('vaultPassphraseLabel')}</div>
                <input className="input" type="password" placeholder={t('vaultPassphraseLabel')}
                  value={vaultPassphrase} onChange={e => setVaultPassphrase(e.target.value)} style={{ width: '100%' }} />
                <p className="settings-note" style={{ marginTop: '0.35rem' }}>{t('vaultPassphraseNote')}</p>
              </div>

              {vaultResult && (
                <div style={{
                  padding: '0.6rem 1rem', borderRadius: '6px', marginTop: '0.6rem', fontSize: '0.82rem',
                  background: vaultResult.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
                  color: vaultResult.ok ? 'var(--success)' : 'var(--rose)',
                  border: `1px solid ${vaultResult.ok ? 'rgba(var(--success-rgb), 0.267)' : 'rgba(var(--rose-rgb), 0.267)'}`,
                }}>
                  {vaultResult.message}
                </div>
              )}

              <div className="settings-backup-row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.6rem' }}>
                <button className="btn" style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
                  onClick={handleVaultVerify} disabled={vaultTesting || vaultSaving || !vaultUrl || !vaultToken || !accountId}>
                  {vaultTesting ? t('vaultVerifying') : t('vaultVerify')}
                </button>
                <button className="btn btn-filled" style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
                  onClick={handleVaultSave} disabled={vaultTesting || vaultSaving || !vaultUrl || !vaultToken || !accountId}>
                  {vaultSaving ? t('saving') : t('vaultSaveEnable')}
                </button>
                {vaultConfigured && (
                  <button className="btn btn-danger" style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
                    onClick={handleVaultDisable} disabled={vaultSaving}>
                    {t('vaultDisable')}
                  </button>
                )}
              </div>

              {/* One-time catch-up: upload existing local-only media to the vault. */}
              {vaultConfigured && (
                <div style={{ marginTop: '0.85rem', borderTop: '1px solid var(--border-soft, rgba(128,128,128,0.25))', paddingTop: '0.7rem' }}>
                  <div className="settings-label">{t('backfillTitle')}</div>
                  <p className="settings-note" style={{ marginTop: '0.15rem', marginBottom: '0.5rem' }}>{t('backfillNote')}</p>
                  <button className="btn" style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
                    onClick={handleBackfill} disabled={backfillRunning}>
                    {backfillRunning
                      ? (backfillProgress.total > 0 ? t('backfillRunning', backfillProgress) : t('backfillScanning'))
                      : t('backfillStart')}
                  </button>
                  {backfillRunning && backfillProgress.total > 0 && (
                    <div style={{ marginTop: '0.5rem', height: '6px', borderRadius: '3px', background: 'rgba(128,128,128,0.2)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.round((100 * backfillProgress.done) / backfillProgress.total)}%`,
                        background: 'var(--amber-bright)', transition: 'width 0.2s',
                      }} />
                    </div>
                  )}
                  {backfillMsg && (
                    <div style={{
                      padding: '0.6rem 1rem', borderRadius: '6px', marginTop: '0.5rem', fontSize: '0.82rem',
                      background: backfillMsg.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
                      color: backfillMsg.ok ? 'var(--success)' : 'var(--rose)',
                      border: `1px solid ${backfillMsg.ok ? 'rgba(var(--success-rgb), 0.267)' : 'rgba(var(--rose-rgb), 0.267)'}`,
                    }}>
                      {backfillMsg.message}
                    </div>
                  )}
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
            background: testResult.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
            color: testResult.ok ? 'var(--success)' : 'var(--rose)',
            border: `1px solid ${testResult.ok ? 'rgba(var(--success-rgb), 0.267)' : 'rgba(var(--rose-rgb), 0.267)'}`,
          }}>
            {testResult.message}
          </div>
        )}

        {/* Last synced */}
        {lastSynced && (
          <p className="settings-note" style={{ marginBottom: '0.75rem' }}>
            {t('lastSynced')} {new Date(lastSynced).toLocaleString(i18n.language)}
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
            {testing ? t('testing') : t('testConnection')}
          </button>

          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
            <button
              className="btn"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={onClose}
            >
              {tc('cancel')}
            </button>
            {isExisting && (
              <button
                className="btn btn-danger"
                style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
                onClick={handleDisable}
              >
                {t('disable')}
              </button>
            )}
            <button
              className="btn btn-filled"
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
              onClick={handleSave}
              disabled={saving || !url || !username || !password}
            >
              {saving ? t('saving') : isExisting ? tc('save') : t('saveAndEnable')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
