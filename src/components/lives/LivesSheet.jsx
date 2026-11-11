import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import BirthdayPicker from '../settings/BirthdayPicker'
import { COLOR_PALETTE } from '../../utils/colors'
import { createLife, updateLife, deleteLife, lifeBirthDate, ME_LIFE_ID } from '../../data/lives'
import { deleteLifeImpact } from '../../data/lifeMembership'
import { canUseMultipleLives, blockingWriters, MultipleLivesBlockedError } from '../../sync/lifeGate'
import { lifeName, lifeColor, blockingDeviceLabel } from './lifeLabels'

// Lives: the list, the editor, and the delete confirmation, in one sheet.
// `start` is 'list', 'add', or a Life id to edit. Adding a Life is refused
// while an older device has synced recently (lifeGate.js); the sheet then says
// which devices to update instead of showing the form.
//
// milestones / chapters are the app's FULL lists (every Life), so the delete
// confirmation counts what the Life really has, not what is on screen.
export default function LivesSheet({ lives, milestones, chapters, start = 'list', onClose, onChanged, onDeleted }) {
  const { t, i18n } = useTranslation('lives')
  const { t: tc } = useTranslation('common')
  const [view, setView] = useState(() => (start === 'list' || start === 'add' ? start : { edit: start }))

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let body
  if (view === 'list') {
    body = (
      <>
        <div className="sheet-header">
          <span className="sheet-title">{t('livesTitle')}</span>
          <button type="button" className="sheet-close" onClick={onClose}>✕</button>
        </div>
        <p className="lives-intro">{t('intro')}</p>
        <ul className="lives-list">
          {lives.map(l => (
            <li key={l.id}>
              <button type="button" className="lives-list-item" style={{ '--life-color': lifeColor(l) }}
                onClick={() => setView({ edit: l.id })}>
                <span className="life-dot" aria-hidden="true" />
                <span className="lives-list-name">{lifeName(l, t)}</span>
                <span className="lives-list-edit">{tc('edit')}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="sheet-actions">
          <span />
          <div className="sheet-actions-right">
            <button type="button" className="btn btn-filled" onClick={() => setView('add')}>{t('addLife')}</button>
          </div>
        </div>
      </>
    )
  } else if (view === 'add' && !canUseMultipleLives()) {
    body = <GatePanel t={t} onBack={() => setView('list')} onClose={onClose} />
  } else if (view === 'add' || view.edit) {
    const life = view === 'add' ? null : lives.find(l => l.id === view.edit)
    body = (
      <LifeForm
        key={life?.id ?? 'new'}
        life={life}
        t={t} tc={tc} language={i18n.language}
        onCancel={() => setView('list')}
        onClose={onClose}
        onSaved={() => { onChanged(); setView('list') }}
        onBlocked={() => setView('add')}
        onDelete={life && life.id !== ME_LIFE_ID ? () => setView({ confirmDelete: life.id }) : null}
      />
    )
  } else if (view.confirmDelete) {
    const life = lives.find(l => l.id === view.confirmDelete)
    body = (
      <DeleteConfirm
        life={life} t={t} tc={tc}
        impact={deleteLifeImpact(life.id, milestones, chapters)}
        onCancel={() => setView({ edit: life.id })}
        onConfirm={async () => {
          await deleteLife(life.id)
          onDeleted(life.id)
          setView('list')
        }}
      />
    )
  }

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet lives-sheet">{body}</div>
    </div>
  )
}

function LifeForm({ life, t, tc, language, onCancel, onClose, onSaved, onBlocked, onDelete }) {
  const isMe = life?.id === ME_LIFE_ID
  const [name, setName]         = useState(life?.name ?? '')
  const [nickname, setNickname] = useState(life?.nickname ?? '')
  const [about, setAbout]       = useState(life?.about ?? '')
  const [birthDate, setBirth]   = useState(() => (life ? lifeBirthDate(life) ?? '' : ''))
  const [deathDate, setDeath]   = useState(life?.deathDate ?? '')
  const [color, setColor]       = useState(life?.color ?? null)
  const [notes, setNotes]       = useState(life?.notes ?? '')
  const [error, setError]       = useState(null)

  async function save(e) {
    e.preventDefault()
    if (!isMe && !name.trim()) { setError(t('nameRequired')); return }
    if (birthDate && deathDate && deathDate < birthDate) { setError(t('deathBeforeBirth')); return }
    const fields = { birthDate: birthDate || null, deathDate: deathDate || null, color, notes }
    try {
      if (isMe) {
        await updateLife(ME_LIFE_ID, { ...fields, nickname, about }, life)
        // Me's birth date is the birthday setting: let the timeline and the
        // widgets pick it up.
        window.dispatchEvent(new Event('lifeglance:sync-applied'))
        window.dispatchEvent(new Event('lifeglance:widget-refresh'))
      } else if (life) {
        await updateLife(life.id, { ...fields, name }, life)
      } else {
        await createLife({ ...fields, name })
      }
      onSaved()
    } catch (err) {
      if (err instanceof MultipleLivesBlockedError) onBlocked()
      else setError(err.message)
    }
  }

  return (
    <form onSubmit={save}>
      <div className="sheet-header">
        <span className="sheet-title">{life ? t('editTitle', { name: lifeName(life, t) }) : t('addTitle')}</span>
        <button type="button" className="sheet-close" onClick={onClose}>✕</button>
      </div>

      {isMe ? (
        <>
          <p className="lives-intro">{t('meNote')}</p>
          <div className="sheet-field">
            <label className="field-label" htmlFor="life-nickname">{t('nicknameLabel')}</label>
            <input id="life-nickname" className="input" value={nickname} onChange={e => setNickname(e.target.value)} />
          </div>
          <div className="sheet-field">
            <label className="field-label" htmlFor="life-about">{t('aboutLabel')}</label>
            <input id="life-about" className="input" value={about} onChange={e => setAbout(e.target.value)} />
          </div>
        </>
      ) : (
        <div className="sheet-field">
          <label className="field-label" htmlFor="life-name">{t('nameLabel')}</label>
          <input id="life-name" className="input" value={name} autoFocus={!life}
            placeholder={t('namePlaceholder')} onChange={e => { setName(e.target.value); setError(null) }} />
        </div>
      )}

      <div className="sheet-field">
        <span className="field-label">{t('birthDateLabel')}</span>
        <BirthdayPicker value={birthDate} onChange={setBirth} language={language} tc={tc} />
      </div>
      <div className="sheet-field">
        <span className="field-label">{t('deathDateLabel')}</span>
        <BirthdayPicker value={deathDate} onChange={setDeath} language={language} tc={tc} />
      </div>

      <div className="sheet-field">
        <span className="field-label">{t('colorLabel')}</span>
        <div className="lives-colors">
          {COLOR_PALETTE.map(c => (
            <button key={c} type="button" className={`lives-color${color === c ? ' active' : ''}`}
              style={{ background: c }} aria-label={c} aria-pressed={color === c}
              onClick={() => setColor(c)} />
          ))}
        </div>
      </div>

      <div className="sheet-field">
        <label className="field-label" htmlFor="life-notes">{t('notesLabel')}</label>
        <textarea id="life-notes" className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
      </div>

      {error && <div className="lives-error" role="alert">{error}</div>}

      <div className="sheet-actions">
        {onDelete ? <button type="button" className="btn-ghost lives-delete" onClick={onDelete}>{t('deleteLife')}</button> : <span />}
        <div className="sheet-actions-right">
          <button type="button" className="btn" onClick={onCancel}>{tc('cancel')}</button>
          <button type="submit" className="btn btn-filled">{tc('save')}</button>
        </div>
      </div>
    </form>
  )
}

function DeleteConfirm({ life, t, tc, impact, onCancel, onConfirm }) {
  const name = lifeName(life, t)
  const lines = [
    impact.only > 0 && t('deleteOnly', { count: impact.only, name }),
    impact.shared > 0 && t('deleteShared', { count: impact.shared, name }),
    impact.chapters > 0 && t('deleteChapters', { count: impact.chapters }),
  ].filter(Boolean)
  return (
    <>
      <div className="sheet-header">
        <span className="sheet-title">{t('deleteConfirmTitle', { name })}</span>
      </div>
      <ul className="lives-impact">
        {(lines.length ? lines : [t('deleteNothing')]).map(l => <li key={l}>{l}</li>)}
      </ul>
      <div className="sheet-actions">
        <span />
        <div className="sheet-actions-right">
          <button type="button" className="btn" onClick={onCancel}>{tc('cancel')}</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>{tc('delete')}</button>
        </div>
      </div>
    </>
  )
}

function GatePanel({ t, onBack, onClose }) {
  const writers = blockingWriters()
  return (
    <>
      <div className="sheet-header">
        <span className="sheet-title">{t('gateTitle')}</span>
        <button type="button" className="sheet-close" onClick={onClose}>✕</button>
      </div>
      <p className="lives-intro">{t('gateBody')}</p>
      <ul className="lives-impact">
        {writers.map(w => <li key={w.key}>{blockingDeviceLabel(w, t)}</li>)}
      </ul>
      <p className="lives-intro">{t('gateFooter')}</p>
      <div className="sheet-actions">
        <span />
        <div className="sheet-actions-right">
          <button type="button" className="btn" onClick={onBack}>{t('back')}</button>
        </div>
      </div>
    </>
  )
}
