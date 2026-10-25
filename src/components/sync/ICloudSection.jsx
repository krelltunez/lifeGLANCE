import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { icloudTransport, ICLOUD_LAST_SYNCED_KEY } from '../../sync/icloud.js'

// The iCloud section of the Cloud Sync dialog (docs/icloud-sync.md), iOS only.
// iCloud sync is on by default with nothing to set up; this is its per-device
// switch (the same preference the first-run question records, so "start fresh"
// can be undone here), "Sync now" and the last-synced stamp. Off is inert, not
// destructive: the iCloud copy stays and other devices keep syncing. On this
// dialog's settings classes, like DirectAccessSection.jsx.

const smallBtn = { fontSize: '0.75rem', padding: '0.4rem 0.85rem' }

export default function ICloudSection({ transport = icloudTransport, runSync, lastError }) {
  const { t, i18n } = useTranslation('sync')
  const [on, setOn] = useState(() => transport.isEnabled())
  const readLastSynced = () => { try { return localStorage.getItem(ICLOUD_LAST_SYNCED_KEY) } catch { return null } }
  const [lastSynced, setLastSynced] = useState(readLastSynced)
  useEffect(() => {
    const timer = setInterval(() => setLastSynced(readLastSynced()), 5 * 1000)
    return () => clearInterval(timer)
  }, [])
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState('idle')   // idle | ok | error
  const [error, setError] = useState(lastError ?? null)

  if (!transport.isSupported()) return null

  const toggle = (next) => {
    transport.setEnabled(next)
    setOn(next)
    setResult('idle')
    if (next) void runSync()
  }
  const syncNow = async () => {
    setSyncing(true)
    setResult('idle')
    try {
      const err = await runSync()
      setLastSynced(readLastSynced())
      setError(err)
      setResult(err ? 'error' : 'ok')
    } finally { setSyncing(false) }
  }
  const when = (iso) => (iso ? new Date(iso).toLocaleString(i18n.language) : t('directAccess.never'))
  const sectionStyle = { borderTop: '1px solid var(--border-soft, rgba(128,128,128,0.25))', paddingTop: '0.85rem', marginTop: '0.5rem' }

  return (
    <div className="settings-section" style={sectionStyle}>
      <div className="settings-label">{t('icloud.title')}</div>
      <label className="settings-toggle-row">
        <span className="settings-toggle-label">{t('icloud.switchLabel')}</span>
        <input type="checkbox" className="settings-toggle" checked={on} onChange={e => toggle(e.target.checked)} />
      </label>
      <p className="settings-note" style={{ marginTop: '0.4rem' }}>{on ? t('icloud.onHint') : t('icloud.offHint')}</p>
      {on && (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem' }}>
            <button type="button" className="btn" style={smallBtn} disabled={syncing} onClick={syncNow}>
              {syncing ? t('icloud.syncing') : t('icloud.syncNow')}
            </button>
            {result === 'ok' && (
              <span className="settings-note" style={{ color: 'var(--success)' }}>{t('icloud.synced', { when: when(lastSynced) })}</span>
            )}
            {result === 'error' && (
              <span className="settings-note" style={{ color: 'var(--rose, #e11d48)' }}>{t('icloud.unavailable', { error: error ?? '' })}</span>
            )}
          </div>
          {result === 'idle' && (
            <p className="settings-note" style={{ marginTop: '0.3rem' }}>{t('icloud.lastSynced', { when: when(lastSynced) })}</p>
          )}
        </>
      )}
    </div>
  )
}
