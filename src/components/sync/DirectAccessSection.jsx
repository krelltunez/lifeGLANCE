import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Capacitor } from '@capacitor/core'
import { directAccessTransport, DIRECT_ACCESS_LAST_SYNCED_KEY } from '../../sync/directAccess.js'
import { FILE_CRYPTO_CONFIG } from '../../sync/cryptoConfig.js'
import { decideEncryptToggle } from './directAccessToggle.js'

// The Direct Access section of the Cloud Sync dialog (docs/direct-access.md):
// connect a folder (Android) or the sync file (iOS), the per-device on/off
// switch, the per-device encrypt switch, "Sync now" and the last-synced stamp.
// It renders the transport's own snapshot through useSyncExternalStore, so a
// folder that goes away or comes back shows without a re-open. Ported from
// lastGLANCE's DirectAccessSection.tsx onto this dialog's settings classes.

const smallBtn = { fontSize: '0.75rem', padding: '0.4rem 0.85rem' }

export default function DirectAccessSection({ transport = directAccessTransport, runSync, lastError }) {
  const { t, i18n } = useTranslation('sync')
  const { t: tc } = useTranslation('common')
  const status = useSyncExternalStore(transport.subscribe, transport.getSnapshot, transport.getSnapshot)
  const ios = Capacitor.getPlatform() === 'ios'
  const [busy, setBusy] = useState(false)
  const run = (fn) => async () => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  // The cycle stamps this on every real read; re-read it while the dialog is open.
  const readLastSynced = () => { try { return localStorage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY) } catch { return null } }
  const [lastSynced, setLastSynced] = useState(readLastSynced)
  useEffect(() => {
    const timer = setInterval(() => setLastSynced(readLastSynced()), 5 * 1000)
    return () => clearInterval(timer)
  }, [])

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState('idle')   // idle | ok | error
  const syncNow = async () => {
    setSyncing(true)
    setSyncResult('idle')
    try {
      await runSync()
      setLastSynced(readLastSynced())
      setSyncResult(transport.getSnapshot().status === 'connected' ? 'ok' : 'error')
    } finally { setSyncing(false) }
  }

  const [askPassphrase, setAskPassphrase] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passphraseError, setPassphraseError] = useState('')
  const toggleEncrypt = async () => {
    const { getSyncPassphrase, hasEncryptionReady } = await import('@glance-apps/sync')
    const action = decideEncryptToggle({ encrypt: status.encrypt, keyInMemory: hasEncryptionReady() || !!getSyncPassphrase() })
    if (action === 'off') { transport.setEncryptsWrites(false); setAskPassphrase(false); return }
    if (action === 'on') { transport.setEncryptsWrites(true); return }
    setPassphrase(''); setConfirm(''); setPassphraseError('')
    setAskPassphrase(true)
  }
  const submitPassphrase = run(async () => {
    const p = passphrase.trim()
    if (!p) return
    if (p !== confirm.trim()) { setPassphraseError(t('passphraseMismatch')); return }
    try {
      const { setupEncryptionKey } = await import('@glance-apps/sync')
      await setupEncryptionKey(p, FILE_CRYPTO_CONFIG)
    } catch (err) {
      setPassphraseError(err instanceof Error ? err.message : t('directAccess.passphraseFailed'))
      return
    }
    transport.setEncryptsWrites(true)
    setAskPassphrase(false)
    setPassphrase(''); setConfirm('')
  })

  const formatLastSynced = (iso) => (iso ? new Date(iso).toLocaleString(i18n.language) : t('directAccess.never'))
  const sectionStyle = { borderTop: '1px solid var(--border-soft, rgba(128,128,128,0.25))', paddingTop: '0.85rem', marginTop: '0.5rem' }
  const row = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }

  if (!status.supported) {
    return (
      <div className="settings-section" style={sectionStyle}>
        <div className="settings-label">{t('directAccess.title')}</div>
        <p className="settings-note" style={{ marginTop: '0.3rem' }}>{t('directAccess.desc')}</p>
        <p className="settings-note" style={{ marginTop: '0.3rem' }}>{t('directAccess.unsupported')}</p>
      </div>
    )
  }

  return (
    <div className="settings-section" style={sectionStyle}>
      <div className="settings-label">{t('directAccess.title')}</div>
      {status.connected ? (
        <label className="settings-toggle-row">
          <span className="settings-toggle-label">{t('directAccess.switchLabel')}</span>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={status.enabled}
            onChange={e => transport.setEnabled(e.target.checked)}
          />
        </label>
      ) : null}
      <p className="settings-note" style={{ marginTop: '0.4rem' }}>{t('directAccess.desc')}</p>
      <p className="settings-note" style={{ marginTop: '0.3rem' }}>{ios ? t('directAccess.iosHint') : t('directAccess.androidHint')}</p>

      {status.pickError && (
        <p className="settings-note" style={{ marginTop: '0.4rem', color: 'var(--rose, #e11d48)' }}>
          {t('directAccess.pickFailed', { reason: status.pickError })}
        </p>
      )}

      {!status.connected ? (
        <>
          <p className="settings-note" style={{ marginTop: '0.5rem' }}>{ios ? t('directAccess.notConnectedFile') : t('directAccess.notConnected')}</p>
          <div style={row}>
            <button type="button" className="btn btn-filled" style={smallBtn} disabled={busy || status.status === 'unknown'}
              onClick={run(() => (ios ? transport.pickFile() : transport.pickFolder()))}>
              {ios ? t('directAccess.chooseFile') : t('directAccess.chooseFolder')}
            </button>
            {ios && (
              <button type="button" className="btn" style={smallBtn} disabled={busy || status.status === 'unknown'}
                onClick={run(() => transport.createFile())}>
                {t('directAccess.createFile')}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="settings-note" style={{ marginTop: '0.5rem' }}>
            {t('directAccess.connectedTo')} <strong>{status.name}</strong>
          </p>
          {status.status === 'unreachable' && (
            <p className="settings-note" style={{ marginTop: '0.3rem', color: 'var(--amber-bright)' }}>{t('directAccess.unreachable')}</p>
          )}
          <p className="settings-note" style={{ marginTop: '0.3rem' }}>
            {status.enabled ? t('directAccess.onHint') : t('directAccess.offHint')}
          </p>
          <div style={row}>
            <button type="button" className="btn" style={smallBtn} disabled={busy}
              onClick={run(() => (ios ? transport.pickFile() : transport.pickFolder()))}>
              {ios ? t('directAccess.changeFile') : t('directAccess.changeFolder')}
            </button>
            <button type="button" className="btn btn-danger" style={smallBtn} disabled={busy}
              onClick={run(() => transport.disconnect())}>
              {t('directAccess.disconnect')}
            </button>
          </div>

          {status.enabled && (
            <div style={{ marginTop: '0.6rem' }}>
              <div style={{ ...row, marginTop: 0, alignItems: 'center' }}>
                <button type="button" className="btn btn-filled" style={smallBtn} disabled={busy || syncing || status.status !== 'connected'} onClick={syncNow}>
                  {syncing ? t('directAccess.syncing') : t('directAccess.syncNow')}
                </button>
                {syncResult === 'ok' && (
                  <span className="settings-note" style={{ color: 'var(--success, #16a34a)' }}>
                    {t('directAccess.synced', { date: formatLastSynced(lastSynced) })}
                  </span>
                )}
                {syncResult === 'error' && (
                  <span className="settings-note" style={{ color: 'var(--rose, #e11d48)' }}>
                    {lastError ? t('directAccess.unavailable', { error: lastError }) : t('directAccess.syncFailed')}
                  </span>
                )}
              </div>
              {syncResult === 'idle' && (
                <p className="settings-note" style={{ marginTop: '0.3rem' }}>{t('directAccess.lastSynced', { date: formatLastSynced(lastSynced) })}</p>
              )}
            </div>
          )}

          <label className="settings-toggle-row" style={{ marginTop: '0.6rem' }}>
            <span className="settings-toggle-label">{t('directAccess.encrypt')}</span>
            <input type="checkbox" className="settings-toggle" checked={status.encrypt} onChange={() => { void toggleEncrypt() }} />
          </label>
          <p className="settings-note" style={{ marginTop: '0.3rem' }}>
            {status.encrypt ? t('directAccess.encryptOnHint') : t('directAccess.encryptHint')}
          </p>
          {askPassphrase && (
            <form onSubmit={(e) => { e.preventDefault(); void submitPassphrase() }} style={{ marginTop: '0.5rem' }}>
              <p className="settings-note">{t('directAccess.encryptPassphraseHint')}</p>
              <input type="password" className="input" value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
                placeholder={t('passphrasePlaceholderNew')} autoComplete="new-password" style={{ width: '100%', marginTop: '0.4rem' }} />
              <input type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder={t('confirmPassphraseLabel')} autoComplete="new-password" style={{ width: '100%', marginTop: '0.4rem' }} />
              {passphraseError && <p className="settings-note" style={{ marginTop: '0.3rem', color: 'var(--rose, #e11d48)' }}>{passphraseError}</p>}
              <div style={row}>
                <button type="submit" className="btn btn-filled" style={smallBtn} disabled={busy || !passphrase.trim()}>{t('directAccess.encryptTurnOn')}</button>
                <button type="button" className="btn" style={smallBtn} disabled={busy} onClick={() => setAskPassphrase(false)}>{tc('cancel')}</button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  )
}
