import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { version as VERSION } from '../../../package.json'

function fmtBytes(n) {
  if (n == null) return '—'
  if (n < 1024)        return `${n} B`
  if (n < 1024 ** 2)   return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3)   return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function useIndexedDBEstimate() {
  const [est, setEst] = useState(null)
  useEffect(() => {
    if (!navigator.storage?.estimate) return
    navigator.storage.estimate()
      .then(({ usage, quota }) => setEst({ usage, quota }))
      .catch(() => {})
  }, [])
  return est
}

function ExternalLinkIcon() {
  return (
    <svg className="help-ext-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M9 2h5v5M14 2 8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export default function HelpModal({ onClose, onOpenShortcuts }) {
  const { t, i18n } = useTranslation('help')

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])


  const idbEst = useIndexedDBEstimate()

  // Build timestamp injected by Vite (see vite.config.js). Falls back to now if
  // the constant isn't defined (e.g. outside a Vite build).
  const built = new Date(typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : Date.now())
  const dateStr = built.toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = built.toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet help-sheet">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="sheet-header">
          <div className="help-header-title">
            <svg className="help-header-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6"/>
              <path d="M9.5 9.5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5c0 1.5-1.5 2-2.5 2.5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              <circle cx="12" cy="16.5" r="0.75" fill="currentColor"/>
            </svg>
            <span className="sheet-title">{t('title')}</span>
          </div>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Contact & Issues ─────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">{t('contactTitle')}</div>
          <div className="help-links">
            <a
              className="help-ext-link"
              href="mailto:support@glance-apps.com"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon />
              support@glance-apps.com
            </a>
            <a
              className="help-ext-link"
              href="https://github.com/krelltunez/lifeGLANCE/issues"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon />
              {t('reportIssue')}
            </a>
          </div>
        </div>

        {/* ── Legal ────────────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">{t('legalTitle')}</div>
          <div className="help-links">
            <a
              className="help-ext-link"
              href="https://www.glance-apps.com/privacy"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon />
              {t('privacyPolicy')}
            </a>
            <a
              className="help-ext-link"
              href="https://www.glance-apps.com/eula"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon />
              {t('termsOfUse')}
            </a>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="help-footer">
          <div className="help-footer-storage">
            <span className="help-footer-meta">
              {t('storage')}&ensp;
              <span className="help-footer-value">
                {idbEst ? `${fmtBytes(idbEst.usage)} / ~${fmtBytes(idbEst.quota)}` : '…'}
              </span>
            </span>
            <span className="help-footer-meta">
              <span className="help-footer-value">v{VERSION}</span>
              <span className="help-footer-dim"> · {dateStr}, {timeStr}</span>
            </span>
          </div>
          <button
            className="help-shortcuts-btn"
            onClick={() => { onClose(); onOpenShortcuts() }}
          >
            <kbd className="help-kbd">?</kbd>
            {t('shortcuts')}
          </button>
        </div>

      </div>
    </div>
  )
}
