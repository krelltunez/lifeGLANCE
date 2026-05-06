import React, { useMemo, useState, useEffect } from 'react'
import { version as VERSION } from '../../../package.json'

const SHORTCUTS = [
  { keys: ['←', '→'],        desc: 'cycle past / future milestones'   },
  { keys: ['↑', '↓'],        desc: 'zoom out / in'                     },
  { keys: ['1–9'],            desc: 'custom zoom to N years'            },
  { keys: ['C'],              desc: 'custom zoom (focus input)'         },
  { keys: ['T'],              desc: 'jump to today'                     },
  { keys: ['P'],              desc: 'past view'                         },
  { keys: ['A'],              desc: 'all view'                          },
  { keys: ['F'],              desc: 'future view'                       },
  { keys: ['⌘Z', 'Ctrl+Z'],  desc: 'undo'                              },
  { keys: ['⌘⇧Z', 'Ctrl+Y'], desc: 'redo'                              },
  { keys: ['M'],              desc: 'mute / unmute sound'               },
  { keys: ['n'],              desc: 'new milestone'                     },
  { keys: ['⇧N'],            desc: 'new chapter'                       },
  { keys: ['E'],              desc: 'export image'                      },
  { keys: ['/'],              desc: 'search milestones'                 },
  { keys: ['S'],              desc: 'settings'                          },
  { keys: ['?'],              desc: 'help'                              },
  { keys: ['Esc'],            desc: 'close modal / exit chapter / exit input' },
]

function fmtBytes(n) {
  if (n == null) return '—'
  if (n < 1024)        return `${n} B`
  if (n < 1024 ** 2)   return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3)   return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

// localStorage — synchronous, just settings/prefs (a few KB)
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

// IndexedDB — async via Storage API; where milestones + media blobs live
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

        {/* ── Keyboard shortcuts ──────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-label">keyboard shortcuts</div>
          <table className="help-shortcuts-table">
            <tbody>
              {SHORTCUTS.map(({ keys, desc }) => (
                <tr key={desc}>
                  <td className="help-keys">
                    {keys.map(k => <kbd key={k} className="help-kbd">{k}</kbd>)}
                  </td>
                  <td className="help-desc">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="help-footer">
          <div className="help-footer-storage">
            <span className="help-footer-meta">
              indexedDB&ensp;
              <span className="help-footer-value">
                {idbEst ? `${fmtBytes(idbEst.usage)} used` : '…'}
              </span>
              {idbEst && (
                <>
                  <span className="help-footer-dim"> / </span>
                  <span className="help-footer-value">{fmtBytes(idbEst.quota)} available</span>
                </>
              )}
            </span>
            <span className="help-footer-meta">
              localStorage&ensp;
              <span className="help-footer-value">{localSize}</span>
              <span className="help-footer-dim"> (settings only)</span>
            </span>
          </div>
          <span className="help-footer-meta help-footer-version">v{VERSION}</span>
        </div>

      </div>
    </div>
  )
}
