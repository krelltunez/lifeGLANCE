import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { grantPrivateAddress } from '../../sync/privateAddress.js'

// The desktop app's private-address permission in Cloud Sync
// (src/sync/privateAddress.js has the flow). Everything here renders nothing
// off the desktop, where there is no such rule.

const smallBtn = { fontSize: '0.75rem', padding: '0.4rem 0.85rem' }

/**
 * "Allow this address…", under a connection test the desktop refused because
 * the server is on a private network. Pressing it raises the native dialog;
 * once allowed, `onAllowed` runs (the caller tries the connection again).
 *
 * @param {object} props
 * @param {string} props.url   the server the test was for
 * @param {'vault' | 'server'} props.kind
 * @param {() => void} props.onAllowed
 */
export function AllowAddressButton({ url, kind, onAllowed }) {
  const { t } = useTranslation('desktop')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState(null)
  const allow = async () => {
    setBusy(true)
    setRefusal(null)
    try {
      const message = await grantPrivateAddress(t, url, kind)
      if (message) setRefusal(message)
      else onAllowed()
    } finally { setBusy(false) }
  }
  return (
    <div style={{ marginTop: '0.6rem' }}>
      <button type="button" className="btn" style={smallBtn} disabled={busy} onClick={allow}>
        {t('privateAddress.allow')}
      </button>
      <p className="settings-note" style={{ marginTop: '0.3rem' }}>{refusal ?? t('privateAddress.allowHint')}</p>
    </div>
  )
}

/** The granted addresses, each with Remove. Nothing when there are none. */
export function AllowedAddresses({ grants, onRemove }) {
  const { t } = useTranslation('desktop')
  if (!grants.length) return null
  return (
    <div className="settings-section" style={{ borderTop: '1px solid var(--border-soft, rgba(128,128,128,0.25))', paddingTop: '0.85rem', marginTop: '0.5rem' }}>
      <div className="settings-label">{t('privateAddress.allowedTitle')}</div>
      {grants.map((grant) => (
        <div key={grant.origin} className="settings-backup-row" style={{ justifyContent: 'space-between', gap: '0.75rem', marginTop: '0.4rem' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{grant.origin}</div>
            <div className="settings-note" style={{ marginTop: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(grant.addresses ?? []).join(', ')}</div>
          </div>
          <button type="button" className="btn btn-danger" style={{ ...smallBtn, flexShrink: 0 }} onClick={() => onRemove(grant.origin)}>
            {t('privateAddress.remove')}
          </button>
        </div>
      ))}
    </div>
  )
}
