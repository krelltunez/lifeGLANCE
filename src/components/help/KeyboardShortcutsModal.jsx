import React from 'react'

const SHORTCUTS = [
  { keys: ['←', '→'],        desc: 'cycle past / future milestones'        },
  { keys: ['↑', '↓'],        desc: 'zoom out / in'                          },
  { keys: ['1–9'],            desc: 'custom zoom to N years'                 },
  { keys: ['C'],              desc: 'custom zoom (focus input)'              },
  { keys: ['T'],              desc: 'jump to today'                          },
  { keys: ['P'],              desc: 'past view'                              },
  { keys: ['A'],              desc: 'all view'                               },
  { keys: ['F'],              desc: 'future view'                            },
  { keys: ['⌘Z', 'Ctrl+Z'],  desc: 'undo'                                   },
  { keys: ['⌘⇧Z', 'Ctrl+Y'], desc: 'redo'                                   },
  { keys: ['M'],              desc: 'mute / unmute sound'                    },
  { keys: ['n'],              desc: 'new milestone'                          },
  { keys: ['⇧N'],            desc: 'new chapter'                            },
  { keys: ['E'],              desc: 'export image'                           },
  { keys: ['/'],              desc: 'search milestones'                      },
  { keys: ['S'],              desc: 'settings'                               },
  { keys: ['?'],              desc: 'keyboard shortcuts'                     },
  { keys: ['Esc'],            desc: 'close modal / exit chapter / exit input'},
]

export default function KeyboardShortcutsModal({ onClose }) {
  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet kbd-sheet">

        <div className="sheet-header">
          <span className="sheet-title">keyboard shortcuts</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

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
    </div>
  )
}
