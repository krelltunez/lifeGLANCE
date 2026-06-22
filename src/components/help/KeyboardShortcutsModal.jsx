import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export default function KeyboardShortcutsModal({ onClose }) {
  const { t } = useTranslation('help')

  const SHORTCUTS = [
    { keys: ['←', '→'],        desc: t('shortcutCycle')              },
    { keys: ['↑', '↓'],        desc: t('shortcutZoom')               },
    { keys: ['1–9'],            desc: t('shortcutCustomZoomN')        },
    { keys: ['C'],              desc: t('shortcutCustomZoomFocus')    },
    { keys: ['T'],              desc: t('shortcutJumpToday')          },
    { keys: ['P'],              desc: t('shortcutPastView')           },
    { keys: ['A'],              desc: t('shortcutAllView')            },
    { keys: ['F'],              desc: t('shortcutFutureView')         },
    { keys: ['⌘Z', 'Ctrl+Z'],  desc: t('shortcutUndo')               },
    { keys: ['⌘⇧Z', 'Ctrl+Y'], desc: t('shortcutRedo')               },
    { keys: ['M'],              desc: t('shortcutMute')               },
    { keys: ['D'],              desc: t('shortcutTheme')              },
    { keys: ['n'],              desc: t('shortcutNewMilestone')       },
    { keys: ['⇧N'],            desc: t('shortcutNewChapter')         },
    { keys: ['E'],              desc: t('shortcutExport')             },
    { keys: ['/'],              desc: t('shortcutSearch')             },
    { keys: ['L'],              desc: t('shortcutActivityLog')        },
    { keys: ['S'],              desc: t('shortcutSettings')           },
    { keys: ['?'],              desc: t('shortcutKeyboardShortcuts')  },
    { keys: ['Esc'],            desc: t('shortcutClose')              },
  ]

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet kbd-sheet">

        <div className="sheet-header">
          <span className="sheet-title">{t('shortcutsTitle')}</span>
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
