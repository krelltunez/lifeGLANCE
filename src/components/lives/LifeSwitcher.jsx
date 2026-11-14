import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { lifeName, lifeColor } from './lifeLabels'
import LifeAvatar from './LifeAvatar'

// The pill next to the logo: which Life is on screen, and a menu to switch,
// add one, or manage them. Shown only once there is more than one Life.
//
// The menu renders in a portal, fixed under the button: the header is its own
// stacking context (z-index 10), so a menu inside it would sit under anything
// layered above the header, such as the hosted demo's floating pill.
export default function LifeSwitcher({ lives, currentLifeId, onSwitch, onAddLife, onManage, onCompare }) {
  const { t } = useTranslation('lives')
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const wrapRef = useRef(null)
  const menuRef = useRef(null)
  const current = lives.find(l => l.id === currentLifeId) ?? lives[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    const close = () => setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const pick = (fn) => () => { setOpen(false); fn() }

  return (
    <div className="life-switcher" ref={wrapRef}>
      <button
        type="button"
        className="life-switcher-btn"
        style={{ '--life-color': lifeColor(current) }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('switcherLabel')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setPos({ top: r.bottom + 4, left: r.left })
          setOpen(o => !o)
        }}
      >
        <LifeAvatar life={current} size="1.1rem" />
        <span className="life-switcher-name">{lifeName(current, t)}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && pos && createPortal(
        <div className="life-switcher-menu" role="menu" ref={menuRef} style={{ top: pos.top, left: pos.left }}>
          {lives.map(l => (
            <button
              key={l.id}
              type="button"
              role="menuitemradio"
              aria-checked={l.id === current?.id}
              className={`life-switcher-item${l.id === current?.id ? ' active' : ''}`}
              style={{ '--life-color': lifeColor(l) }}
              onClick={pick(() => onSwitch(l.id))}
            >
              <LifeAvatar life={l} size="1rem" />
              {lifeName(l, t)}
            </button>
          ))}
          <div className="life-switcher-sep" role="separator" />
          {onCompare && lives.length > 1 && (
            <button type="button" role="menuitem" className="life-switcher-item" onClick={pick(onCompare)}>{t('compareLives')}</button>
          )}
          <button type="button" role="menuitem" className="life-switcher-item" onClick={pick(onAddLife)}>{t('addLife')}</button>
          <button type="button" role="menuitem" className="life-switcher-item" onClick={pick(onManage)}>{t('manageLives')}</button>
        </div>,
        document.body,
      )}
    </div>
  )
}
