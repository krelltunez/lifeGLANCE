import React, { useState, useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { loadIntentsConfig, saveIntentsConfig, enableIntentsEncryption, resolveDirectAccessKey } from '../../lib/intentsTransport.js'
import { readVaultIntentsConnection } from '../../lib/intentsVaultTransport.js'
import { isNativePlatform, nativeWebdavResponse } from '../../sync/nativeHttp.js'
import { directAccessTransport } from '../../sync/directAccess.js'
import DirectAccessFileRow from '../sync/DirectAccessFileRow.jsx'

const PROXY_URL = import.meta.env.VITE_WEBDAV_PROXY_URL ?? '/api/webdav-proxy'

export default function IntegrationSettings() {
  const { t } = useTranslation('dayglance')
  const [cfg, setCfg] = useState(loadIntentsConfig)
  const [testStatus, setTestStatus] = useState(null)
  const [testMsg,    setTestMsg]    = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [encStatus,  setEncStatus]  = useState(null)
  const [encMsg,     setEncMsg]     = useState('')

  function update(partial) {
    setCfg(prev => {
      const next = { ...prev, ...partial }
      saveIntentsConfig(next)
      return next
    })
  }

  async function handleTest() {
    setTestStatus('testing')
    setTestMsg('')
    try {
      const base   = cfg.webdavUrl.replace(/\/$/, '')
      const dir    = cfg.eventsPath.endsWith('/') ? cfg.eventsPath : cfg.eventsPath + '/'
      const target = `${base}${dir}`
      const authHeader = cfg.webdavUser
        ? { Authorization: 'Basic ' + btoa(`${cfg.webdavUser}:${cfg.webdavPass}`) }
        : {}
      const extraHeaders = { ...authHeader, 'Depth': '0', 'Content-Type': 'application/xml' }
      const propfindBody = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>'
      // Native shells hit the WebDAV server directly; the browser/PWA path keeps
      // routing through the CORS proxy (X-WebDAV-Url header).
      const res = isNativePlatform()
        ? await nativeWebdavResponse('PROPFIND', target, extraHeaders, propfindBody)
        : await fetch(PROXY_URL || target, {
            method:  'PROPFIND',
            headers: PROXY_URL ? { ...extraHeaders, 'X-WebDAV-Url': target } : extraHeaders,
            body:    propfindBody,
          })
      if (res.ok || res.status === 207) {
        setTestStatus('ok')
        setTestMsg(t('connectionOk'))
      } else if (res.status === 404) {
        setTestStatus('error')
        setTestMsg(t('directoryNotFound', { path: cfg.eventsPath }))
      } else {
        setTestStatus('error')
        setTestMsg(t('unexpectedResponse', { status: res.status, statusText: res.statusText }))
      }
    } catch (err) {
      setTestStatus('error')
      setTestMsg(t('connectionFailed', { message: err.message }))
    }
  }

  async function handleEncryptionToggle(enabled) {
    if (!enabled) {
      update({ encryptionEnabled: false })
      setEncStatus(null)
      setEncMsg('')
      return
    }
    update({ encryptionEnabled: true })
  }

  async function handleSetupEncryption() {
    if (!passphrase) return
    setEncStatus('saving')
    setEncMsg('')
    try {
      await enableIntentsEncryption(passphrase)
      setCfg(loadIntentsConfig())
      setPassphrase('')
      setEncStatus('ok')
      setEncMsg(t('encryptionEnabled'))
    } catch (err) {
      setEncStatus('error')
      setEncMsg(t('setupFailed', { message: err.message }))
    }
  }

  const hasUrl     = !!cfg.webdavUrl.trim()
  const transport  = cfg.transport ?? 'webdav'
  const vaultReady = !!readVaultIntentsConnection()

  // Direct Access (docs/direct-access.md, step 3): the folder picked under
  // Cloud Sync carries the event set; this transport is usable once that
  // folder is connected. The event set is encrypted iff the Direct Access
  // encrypt switch is, under the sync passphrase: when it is on and this
  // device has no key for the folder's salt, the passphrase is asked for
  // here, once, so the opt-in never ends with intents silently held.
  const da = useSyncExternalStore(directAccessTransport.subscribe, directAccessTransport.getSnapshot, directAccessTransport.getSnapshot)
  const daSelected = cfg.enabled && transport === 'directAccess'
  const [daKey, setDaKey] = useState('unknown')   // unknown | ready | needed
  const [daPassphrase, setDaPassphrase] = useState('')
  const [daStatus, setDaStatus] = useState(null)
  const [daMsg, setDaMsg] = useState('')
  useEffect(() => {
    if (!daSelected || !da.connected || !da.encrypt) return
    let cancelled = false
    resolveDirectAccessKey()
      .then(r => { if (!cancelled) setDaKey(r.key ? 'ready' : 'needed') })
      .catch(() => { if (!cancelled) setDaKey('needed') })
    return () => { cancelled = true }
  }, [daSelected, da.connected, da.encrypt])

  async function handleDaPassphrase() {
    if (!daPassphrase) return
    setDaStatus('saving')
    setDaMsg('')
    try {
      const { setSyncPassphrase } = await import('@glance-apps/sync')
      setSyncPassphrase(daPassphrase)
      const r = await resolveDirectAccessKey()
      if (!r.key) throw new Error('no key')
      setDaKey('ready')
      setDaPassphrase('')
      setDaStatus('ok')
      setDaMsg(t('directAccessKeyReady'))
      window.dispatchEvent(new Event('lifeglance:intents-key-ready'))
    } catch (err) {
      setDaStatus('error')
      setDaMsg(t('setupFailed', { message: err.message }))
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-label">{t('integrationTitle')}</div>

      <label className="settings-toggle-row">
        <span className="settings-toggle-label">{t('enableLinking')}</span>
        <input
          type="checkbox"
          className="settings-toggle"
          checked={cfg.enabled}
          onChange={e => update({ enabled: e.target.checked })}
        />
      </label>

      {cfg.enabled && (
        <>
          {/* Transport selector — either WebDAV or GLANCEvault (mutually exclusive). */}
          <div className="settings-intents-field" style={{ marginTop: '0.5rem' }}>
            <label className="field-label" style={{ fontSize: '0.72rem' }}>{t('transportLabel')}</label>
            <div className="settings-intents-row" style={{ gap: '1.25rem', marginTop: '0.3rem' }}>
              <label className="recurrence-toggle-row" style={{ gap: '0.4rem', cursor: 'pointer', margin: 0 }}>
                <input
                  type="radio"
                  name="intents-transport"
                  checked={transport === 'webdav'}
                  onChange={() => update({ transport: 'webdav' })}
                />
                <span className="settings-toggle-label">{t('transportWebdav')}</span>
              </label>
              <label className="recurrence-toggle-row" style={{ gap: '0.4rem', cursor: 'pointer', margin: 0 }}>
                <input
                  type="radio"
                  name="intents-transport"
                  checked={transport === 'vault'}
                  onChange={() => update({ transport: 'vault' })}
                />
                <span className="settings-toggle-label">{t('transportVault')}</span>
              </label>
              {da.supported && (
                <label className="recurrence-toggle-row" style={{ gap: '0.4rem', cursor: 'pointer', margin: 0 }}>
                  <input
                    type="radio"
                    name="intents-transport"
                    checked={transport === 'directAccess'}
                    onChange={() => update({ transport: 'directAccess' })}
                  />
                  <span className="settings-toggle-label">{t('transportDirectAccess')}</span>
                </label>
              )}
            </div>
          </div>

          {transport === 'webdav' && (
            <>
              <div className="settings-intents-field">
                <label className="field-label" style={{ fontSize: '0.72rem' }}>
                  {t('webdavUrl')}
                </label>
                <input
                  className="input input-sm"
                  type="url"
                  placeholder="https://cloud.example.com/remote.php/dav/files/user"
                  value={cfg.webdavUrl}
                  onChange={e => update({ webdavUrl: e.target.value })}
                  autoComplete="off"
                />
              </div>

              <div className="settings-intents-row">
                <div className="settings-intents-field" style={{ flex: 1 }}>
                  <label className="field-label" style={{ fontSize: '0.72rem' }}>{t('username')}</label>
                  <input
                    className="input input-sm"
                    type="text"
                    placeholder="user"
                    value={cfg.webdavUser}
                    onChange={e => update({ webdavUser: e.target.value })}
                    autoComplete="username"
                  />
                </div>
                <div className="settings-intents-field" style={{ flex: 1 }}>
                  <label className="field-label" style={{ fontSize: '0.72rem' }}>{t('passwordToken')}</label>
                  <input
                    className="input input-sm"
                    type="password"
                    placeholder="••••••••"
                    value={cfg.webdavPass}
                    onChange={e => update({ webdavPass: e.target.value })}
                    autoComplete="current-password"
                  />
                </div>
              </div>

              <div className="settings-intents-field">
                <label className="field-label" style={{ fontSize: '0.72rem' }}>
                  {t('eventsPath')} <span className="settings-note" style={{ marginTop: 0 }}>{t('eventsPathDefault')}</span>
                </label>
                <input
                  className="input input-sm"
                  type="text"
                  placeholder="/GLANCE/events/"
                  value={cfg.eventsPath}
                  onChange={e => update({ eventsPath: e.target.value })}
                  autoComplete="off"
                />
              </div>

              <div className="settings-intents-row" style={{ alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
                <button
                  className="btn"
                  style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }}
                  disabled={!hasUrl || testStatus === 'testing'}
                  onClick={handleTest}
                >
                  {testStatus === 'testing' ? t('testing') : t('testConnection')}
                </button>
                {testStatus && testStatus !== 'testing' && (
                  <span className={`settings-note ${testStatus === 'ok' ? 'intents-test-ok' : 'intents-test-err'}`}
                    style={{ marginTop: 0 }}>
                    {testMsg}
                  </span>
                )}
              </div>

              {/* Encryption (file tier — the vault tier is always encrypted). */}
              <label className="settings-toggle-row" style={{ marginTop: '0.5rem' }}>
                <span className="settings-toggle-label">{t('encryptEvents')}</span>
                <input
                  type="checkbox"
                  className="settings-toggle"
                  checked={cfg.encryptionEnabled}
                  onChange={e => handleEncryptionToggle(e.target.checked)}
                />
              </label>

              {cfg.encryptionEnabled && (
                <div className="settings-intents-field" style={{ marginTop: '0.25rem' }}>
                  <p className="settings-note" style={{ marginTop: 0, marginBottom: '0.4rem' }}>
                    {t('encryptionNote')}
                  </p>
                  <div className="settings-intents-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      className="input input-sm"
                      type="password"
                      placeholder={t('enterPassphrase')}
                      value={passphrase}
                      onChange={e => setPassphrase(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSetupEncryption()}
                      autoComplete="current-password"
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn"
                      style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem', whiteSpace: 'nowrap' }}
                      disabled={!passphrase || encStatus === 'saving'}
                      onClick={handleSetupEncryption}
                    >
                      {encStatus === 'saving' ? t('activating') : t('activate')}
                    </button>
                  </div>
                  {encStatus && encStatus !== 'saving' && (
                    <span className={`settings-note ${encStatus === 'ok' ? 'intents-test-ok' : 'intents-test-err'}`}
                      style={{ marginTop: '0.3rem', display: 'block' }}>
                      {encMsg}
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          {transport === 'vault' && (
            <div className="settings-intents-field">
              <p className="settings-note" style={{ marginTop: 0 }}>{t('vaultTransportNote')}</p>
              {!vaultReady && (
                <p className="settings-note intents-test-err" style={{ marginTop: '0.4rem' }}>
                  {t('vaultNotConfigured')}
                </p>
              )}
            </div>
          )}

          {transport === 'directAccess' && (
            <div className="settings-intents-field">
              <p className="settings-note" style={{ marginTop: 0 }}>{t('directAccessTransportNote')}</p>
              {!da.connected ? (
                <p className="settings-note intents-test-err" style={{ marginTop: '0.4rem' }}>
                  {t('directAccessNotConnected')}
                </p>
              ) : (
                <>
                  <p className="settings-note" style={{ marginTop: '0.4rem' }}>
                    {da.encrypt ? t('directAccessEncryptedNote') : t('directAccessPlaintextNote')}
                  </p>
                  {da.encrypt && daKey === 'needed' && (
                    <div style={{ marginTop: '0.4rem' }}>
                      <p className="settings-note" style={{ marginTop: 0, marginBottom: '0.4rem' }}>{t('directAccessPassphraseRequired')}</p>
                      <div className="settings-intents-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          className="input input-sm"
                          type="password"
                          placeholder={t('enterPassphrase')}
                          value={daPassphrase}
                          onChange={e => setDaPassphrase(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleDaPassphrase()}
                          autoComplete="current-password"
                          style={{ flex: 1 }}
                        />
                        <button
                          className="btn"
                          style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem', whiteSpace: 'nowrap' }}
                          disabled={!daPassphrase || daStatus === 'saving'}
                          onClick={handleDaPassphrase}
                        >
                          {daStatus === 'saving' ? t('activating') : t('activate')}
                        </button>
                      </div>
                    </div>
                  )}
                  {daStatus && daStatus !== 'saving' && (
                    <span className={`settings-note ${daStatus === 'ok' ? 'intents-test-ok' : 'intents-test-err'}`}
                      style={{ marginTop: '0.3rem', display: 'block' }}>
                      {daMsg}
                    </span>
                  )}
                  <DirectAccessFileRow slot="events" />
                </>
              )}
            </div>
          )}

          {/* Poll cadence — applies to whichever transport is active. */}
          <div className="settings-intents-field" style={{ marginTop: '0.5rem' }}>
            <label className="field-label" style={{ fontSize: '0.72rem' }}>
              {t('pollInterval')}
            </label>
            <input
              className="input input-sm"
              type="number"
              min="1"
              max="30"
              style={{ width: '5rem' }}
              value={cfg.pollIntervalMin}
              onChange={e => update({ pollIntervalMin: Math.max(1, Math.min(30, Number(e.target.value))) })}
            />
          </div>

          <p className="settings-note" style={{ marginTop: '0.5rem' }}>
            {t('integrationNote')}
          </p>
        </>
      )}
    </div>
  )
}
