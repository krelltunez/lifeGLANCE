import React, { useMemo, useState, useEffect } from 'react'
import { version as VERSION } from '../../../package.json'

function fmtBytes(n) {
  if (n == null) return '—'
  if (n < 1024)        return `${n} B`
  if (n < 1024 ** 2)   return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3)   return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function useLocalStorageSize() {
  return useMemo(() => {
    try {
      const bytes = Object.keys(localStorage).reduce(
        (sum, k) => sum + (localStorage.getItem(k)?.length ?? 0) * 2, 0
      )
      return fmtBytes(bytes)
    } catch { return '—' }
  }, [])
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

export default function HelpModal({ onClose }) {
  const localSize = useLocalStorageSize()
  const idbEst    = useIndexedDBEstimate()

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet help-sheet">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="sheet-header">
          <span className="sheet-title">help</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* ── About ───────────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">about</div>
          <p className="help-about-text">
            <strong className="help-about-name">lifeGLANCE</strong> is a personal
            timeline for your milestones and life chapters — all stored locally
            in your browser, never sent anywhere.
          </p>
          <p className="help-about-text">
            Add milestones with <kbd className="help-kbd">n</kbd>, create chapters
            with <kbd className="help-kbd">⇧N</kbd>, and navigate your timeline
            with the arrow keys. Press <kbd className="help-kbd">?</kbd> to see
            all keyboard shortcuts.
          </p>
        </div>

        {/* ── Data & privacy ──────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">data &amp; privacy</div>
          <p className="help-about-text">
            Everything lives in your browser — milestones, photos, and settings.
            Clearing site data will erase all your entries. Export a backup
            anytime with <kbd className="help-kbd">E</kbd>.
          </p>
        </div>

        {/* ── Storage ─────────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">storage</div>
          <div className="help-storage-grid">
            <span className="help-storage-label">indexedDB</span>
            <span className="help-storage-value">
              {idbEst ? `${fmtBytes(idbEst.usage)} used` : '…'}
              {idbEst && (
                <span className="help-storage-dim">
                  {' '}/ {fmtBytes(idbEst.quota)} available
                </span>
              )}
            </span>
            <span className="help-storage-label">localStorage</span>
            <span className="help-storage-value">
              {localSize}
              <span className="help-storage-dim"> (settings only)</span>
            </span>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="help-footer">
          <span className="help-footer-meta">
            all data stays on your device
          </span>
          <span className="help-footer-meta help-footer-version">v{VERSION}</span>
        </div>

      </div>
    </div>
  )
}
