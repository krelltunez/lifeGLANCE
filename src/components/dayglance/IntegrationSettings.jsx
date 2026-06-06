import React, { useState } from 'react'
import { loadIntentsConfig, saveIntentsConfig, DEFAULT_CONFIG } from '../../lib/intentsTransport.js'

const PROXY_URL = import.meta.env.VITE_WEBDAV_PROXY_URL ?? '/api/webdav-proxy'

// Section shown inside SettingsModal for the dayGLANCE integration.
// All integration UI is gated behind the user enabling the integration and
// providing a WebDAV URL — standalone mode (no config) hides this entirely
// from the parent via the isIntegrationEnabled() check.
export default function IntegrationSettings() {
  const [cfg, setCfg] = useState(loadIntentsConfig)
  const [testStatus, setTestStatus] = useState(null) // null | 'testing' | 'ok' | 'error'
  const [testMsg,    setTestMsg]    = useState('')

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
      const fetchUrl = PROXY_URL || target
      const fetchHeaders = PROXY_URL
        ? { ...extraHeaders, 'X-WebDAV-Url': target }
        : extraHeaders
      const res = await fetch(fetchUrl, {
        method:  'PROPFIND',
        headers: fetchHeaders,
        body:    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
      })
      if (res.ok || res.status === 207) {
        setTestStatus('ok')
        setTestMsg('Connected - events directory is reachable.')
      } else if (res.status === 404) {
        setTestStatus('error')
        setTestMsg(`Events directory not found (404). Create it first: ${cfg.eventsPath}`)
      } else {
        setTestStatus('error')
        setTestMsg(`Unexpected response: ${res.status} ${res.statusText}`)
      }
    } catch (err) {
      setTestStatus('error')
      setTestMsg(`Connection failed: ${err.message}`)
    }
  }

  const hasUrl = !!cfg.webdavUrl.trim()

  return (
    <div className="settings-section">
      <div className="settings-label">dayGLANCE integration</div>

      <label className="settings-toggle-row">
        <span className="settings-toggle-label">enable Goal↔Milestone linking</span>
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
              WebDAV base URL
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
              <label className="field-label" style={{ fontSize: '0.72rem' }}>Username</label>
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
              <label className="field-label" style={{ fontSize: '0.72rem' }}>Password / token</label>
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
              Events path <span className="settings-note" style={{ marginTop: 0 }}>(default: /GLANCE/events/)</span>
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
              {testStatus === 'testing' ? 'testing…' : 'test connection'}
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
              Poll interval (minutes)
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
            lifeGLANCE and dayGLANCE must point at the same WebDAV endpoint and
            events path. Milestones you mark "track as dayGLANCE Goal" will appear
            as goals in dayGLANCE; Goal completions and date changes sync back here.
          </p>
        </>
      )}
    </div>
  )
}
