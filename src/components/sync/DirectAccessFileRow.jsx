import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Capacitor } from '@capacitor/core'
import { directAccessTransport } from '../../sync/directAccess.js'

// On iPhone and iPad the Direct Access bookmark is of a file, not a folder,
// since Files hands over no folder: the intents event set is a bookmarked
// file of its own, picked (the one another device already created) or
// created (a first device) from the settings section that uses it, the
// dayGLANCE integration. Renders nothing off iOS, and nothing until the sync
// file is connected, since it is the same folder tree. The roster slot is
// kept for parity with the sibling apps; lifeGLANCE has no roster.

const smallBtn = { fontSize: '0.75rem', padding: '0.4rem 0.85rem' }

export default function DirectAccessFileRow({ slot = 'events', transport = directAccessTransport }) {
  const { t } = useTranslation('sync')
  const status = useSyncExternalStore(transport.subscribe, transport.getSnapshot, transport.getSnapshot)
  const [busy, setBusy] = useState(false)
  if (Capacitor.getPlatform() !== 'ios' || !status.supported || !status.connected) return null
  const file = slot === 'users' ? status.roster : status.events
  if (!file) return null

  const run = (fn) => async () => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }
  const pick = run(() => (slot === 'users' ? transport.pickUsersFile() : transport.pickEventsFile()))
  const create = run(() => (slot === 'users' ? transport.createUsersFile() : transport.createEventsFile()))
  const forget = run(() => (slot === 'users' ? transport.forgetUsersFile() : transport.forgetEventsFile()))
  const k = slot === 'users' ? 'roster' : 'events'
  const chosen = file.configured
    ? t(`directAccess.${k}Chosen`, { name: file.name ?? '' })
    : t(`directAccess.${k}NotChosen`)

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <p className="settings-note" style={{ marginTop: 0 }}>{t(`directAccess.${k}Hint`)}</p>
      <p className="settings-note" style={{ marginTop: '0.3rem' }}><strong>{chosen}</strong></p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
        {file.configured ? (
          <>
            <button type="button" className="btn" style={smallBtn} onClick={pick} disabled={busy}>{t('directAccess.fileChange')}</button>
            <button type="button" className="btn" style={smallBtn} onClick={forget} disabled={busy}>{t('directAccess.fileForget')}</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-filled" style={smallBtn} onClick={pick} disabled={busy}>{t('directAccess.fileChoose')}</button>
            <button type="button" className="btn" style={smallBtn} onClick={create} disabled={busy}>{t('directAccess.fileCreate')}</button>
          </>
        )}
      </div>
    </div>
  )
}
