import React, { useState } from 'react'

export default function SyncPassphraseModal({ onClose, onUnlocked }) {
  const [passphrase, setPassphrase] = useState('')
  const [error,      setError]      = useState(null)
  const [loading,    setLoading]    = useState(false)

  async function handleUnlock(e) {
    e.preventDefault()
    if (!passphrase) return
    setLoading(true)
    setError(null)
    try {
      const { setSyncPassphrase } = await import('@glance-apps/sync')
      setSyncPassphrase(passphrase)
      onUnlocked()
    } catch (err) {
      setError('Incorrect passphrase. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ maxWidth: '420px' }}>
        <div className="sheet-header">
          <span className="sheet-title">enter sync passphrase</span>
          <button className="sheet-close" onClick={onClose}>&#x2715;</button>
        </div>

        <p className="settings-note" style={{ marginBottom: '1rem' }}>
          Your data is encrypted. Enter your sync passphrase to continue.
        </p>

        <form onSubmit={handleUnlock}>
          <input
            className="input"
            type="password"
            placeholder="passphrase"
            value={passphrase}
            onChange={e => setPassphrase(e.target.value)}
            autoFocus
            style={{ width: '100%', marginBottom: '0.75rem' }}
          />

          {error && (
            <p style={{ color: '#E85D75', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
              {error}
            </p>
          )}

          <div className="sheet-actions" style={{ justifyContent: 'flex-end', gap: '0.5rem', display: 'flex' }}>
            <button type="button" className="btn" onClick={onClose}>
              cancel
            </button>
            <button
              type="submit"
              className="btn btn-filled"
              disabled={loading || !passphrase}
            >
              {loading ? 'unlocking...' : 'unlock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
