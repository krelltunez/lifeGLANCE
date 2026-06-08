import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { loadIntentsConfig, saveIntentsConfig, enableIntentsEncryption } from '../../lib/intentsTransport.js'
import { loadIntentsRootKey } from '../../lib/intentsKeyStore.js'

const PROXY_URL = import.meta.env.VITE_WEBDAV_PROXY_URL ?? '/api/webdav-proxy'

export default function IntegrationSettings() {
  const { t } = useTranslation('dayglance')
  const { t: ts } = useTranslation('sync')
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
      const fetchHeaders = PROXY_URL
        ? { ...extraHeaders, 'X-WebDAV-Url': target }
        : extraHeaders
      const res = await fetch(PROXY_URL || target, {
        method:  'PROPFIND',
        headers: fetchHeaders,
        body:    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
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

  const hasUrl   = !!cfg.webdavUrl.trim()

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
              {testStatus === 'testing' ? t('testing') : ts('testConnection')}
            </button>
            {testStatus && testStatus !== 'testing' && (
              <span className={`settings-note ${testStatus === 'ok' ? 'intents-test-ok' : 'intents-test-err'}`}
                style={{ marginTop: 0 }}>
                {testMsg}
              </span>
            )}
          </div>

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

          {/* Encryption */}
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

          <p className="settings-note" style={{ marginTop: '0.5rem' }}>
            {t('integrationNote')}
          </p>
        </>
      )}
    </div>
  )
}
