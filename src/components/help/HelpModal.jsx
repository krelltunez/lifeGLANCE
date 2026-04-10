import React, { useMemo } from 'react'

const VERSION = '0.1.0'

const SHORTCUTS = [
  { keys: ['←', '→'],  desc: 'cycle past / future milestones'   },
  { keys: ['↑', '↓'],  desc: 'zoom out / in'                     },
  { keys: ['T'],        desc: 'jump to today'                     },
  { keys: ['P'],        desc: 'past view'                         },
  { keys: ['A'],        desc: 'all view'                          },
  { keys: ['F'],        desc: 'future view'                       },
  { keys: ['1–9'],      desc: 'custom zoom to N years'            },
  { keys: ['N'],        desc: 'new milestone'                     },
  { keys: ['S'],        desc: 'settings'                          },
  { keys: ['?'],        desc: 'help'                              },
  { keys: ['Esc'],      desc: 'close modal'                       },
]

function useStorageEstimate() {
  return useMemo(() => {
    try {
      const bytes = Object.keys(localStorage).reduce(
        (sum, k) => sum + (localStorage.getItem(k)?.length ?? 0) * 2, 0
      )
      if (bytes < 1024)       return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    } catch {
      return '—'
    }
  }, [])
}

export default function HelpModal({ onClose }) {
  const storage = useStorageEstimate()

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
          <span className="help-footer-meta">local storage: {storage}</span>
          <span className="help-footer-meta">v{VERSION}</span>
        </div>

      </div>
    </div>
  )
}
