import { useTranslation } from 'react-i18next'

// Asked once, on a launch that finds data in iCloud and none of this device's
// own (dayGLANCE's ICloudFirstRunModal). Deleting the app leaves the file in
// the iCloud container, and reinstalling turns iOS's per-app iCloud switch back
// on, so without this the app would restore everything silently and with no
// way to decline. Two choices: at first run this device holds nothing, so
// "merge" and "use the iCloud copy" are the same act. Either answer is kept;
// starting fresh can be undone with the iCloud switch in Cloud Sync.

export default function ICloudFirstRunModal({ info, onRestore, onStartFresh }) {
  const { t, i18n } = useTranslation('sync')
  if (!info) return null
  const life = info.data?.lives?.default
  const count = Array.isArray(life?.milestones) ? life.milestones.length : 0

  return (
    <div className="sheet-overlay">
      <div className="sheet" style={{ maxWidth: '420px' }} role="dialog" aria-modal="true" aria-labelledby="icloud-first-run-title">
        <div className="sheet-header">
          <span className="sheet-title" id="icloud-first-run-title">{t('icloud.firstRun.title')}</span>
        </div>
        <p className="settings-note" style={{ marginBottom: '0.5rem' }}>{t('icloud.firstRun.body', { count })}</p>
        {info.lastModified && (
          <p className="settings-note" style={{ marginBottom: '1rem' }}>
            {t('icloud.firstRun.lastModified', { when: new Date(info.lastModified).toLocaleString(i18n.language) })}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button type="button" className="btn btn-filled" style={{ textAlign: 'left' }} onClick={onRestore}>
            <div>{t('icloud.firstRun.restore')}</div>
            <div style={{ fontSize: '0.78rem', opacity: 0.85 }}>{t('icloud.firstRun.restoreHint')}</div>
          </button>
          <button type="button" className="btn" style={{ textAlign: 'left' }} onClick={onStartFresh}>
            <div>{t('icloud.firstRun.startFresh')}</div>
            <div style={{ fontSize: '0.78rem', opacity: 0.85 }}>{t('icloud.firstRun.startFreshHint')}</div>
          </button>
        </div>
      </div>
    </div>
  )
}
