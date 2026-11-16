import { useTranslation } from 'react-i18next'

// A small card in the corner when a newer desktop release can be downloaded
// (hooks/useUpdateNotice.js). Download opens the release page in the browser:
// the shell hands every link to the system (electron/externalLinks.js).
export default function UpdateNotice({ update, onDismiss }) {
  const { t } = useTranslation('desktop')
  if (!update) return null
  return (
    <div className="update-notice" role="status">
      <span className="update-notice-text">{t('update.available', { version: update.version })}</span>
      <button type="button" className="btn btn-filled update-notice-btn"
        onClick={() => { window.open(update.url, '_blank', 'noopener,noreferrer'); onDismiss() }}>
        {t('update.download')}
      </button>
      <button type="button" className="update-notice-close" aria-label={t('update.dismiss')} title={t('update.dismiss')} onClick={onDismiss}>
        &#x2715;
      </button>
    </div>
  )
}
