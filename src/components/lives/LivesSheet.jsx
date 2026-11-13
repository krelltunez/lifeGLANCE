import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import BirthdayPicker from '../settings/BirthdayPicker'
import { COLOR_PALETTE } from '../../utils/colors'
import { createLife, updateLife, deleteLife, lifeBirthDate, ME_LIFE_ID } from '../../data/lives'
import { deleteLifeImpact } from '../../data/lifeMembership'
import { listRelationships, relationshipToMe, setRelationshipToMe, RELATIONSHIP_TYPES } from '../../data/relationships'
import { canUseMultipleLives, blockingWriters, MultipleLivesBlockedError } from '../../sync/lifeGate'
import { lifeName, lifeColor, blockingDeviceLabel } from './lifeLabels'
import { pickPhotoNative } from '../../native/mediaPicker'
import { saveLifePhoto, removeLifePhoto, forgetLifePhoto, useLifePhotoUrl } from './lifePhoto'
import LifeAvatar from './LifeAvatar'

// Lives: the list, the editor, and the delete confirmation, in one sheet.
// `start` is 'list', 'add', 'restoreBlocked' (a restore refused by the gate),
// or a Life id to edit. Adding a Life is refused
// while an older device has synced recently (lifeGate.js); the sheet then says
// which devices to update instead of showing the form.
//
// milestones / chapters are the app's FULL lists (every Life), so the delete
// confirmation counts what the Life really has, not what is on screen.
//
// Relationship edges are read here, not kept in App state: only this sheet
// shows them in v5.0. A sync that changes one announces lifeglance:lives-changed.
export default function LivesSheet({ lives, milestones, chapters, start = 'list', onClose, onChanged, onDeleted }) {
  const { t, i18n } = useTranslation('lives')
  const { t: tc } = useTranslation('common')
  const [view, setView] = useState(() => (['list', 'add', 'restoreBlocked'].includes(start) ? start : { edit: start }))
  const [edges, setEdges] = useState(null)   // null until loaded

  useEffect(() => {
    let live = true
    const load = () => listRelationships().then(all => { if (live) setEdges(all) }).catch(() => { if (live) setEdges([]) })
    load()
    window.addEventListener('lifeglance:lives-changed', load)
    return () => { live = false; window.removeEventListener('lifeglance:lives-changed', load) }
  }, [])
  const reloadEdges = () => listRelationships().then(setEdges).catch(() => {})

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
          {lives.map(l => {
            const rel = edges && l.id !== ME_LIFE_ID ? relationshipToMe(l.id, edges) : null
            return (
            <li key={l.id}>
              <button type="button" className="lives-list-item" style={{ '--life-color': lifeColor(l) }}
                onClick={() => setView({ edit: l.id })}>
                <LifeAvatar life={l} size="1.6rem" />
                <span className="lives-list-name">
                  {lifeName(l, t)}
                  {rel && <span className="lives-list-rel">{relationshipText(rel.type, t)}</span>}
                </span>
                <span className="lives-list-edit">{tc('edit')}</span>
              </button>
            </li>
            )
          })}
        </ul>
        <div className="sheet-actions">
          <span />
          <div className="sheet-actions-right">
            <button type="button" className="btn btn-filled" onClick={() => setView('add')}>{t('addLife')}</button>
          </div>
        </div>
      </>
    )
  } else if (view === 'restoreBlocked') {
    body = <GatePanel t={t} footer={t('gateRestoreFooter')} onBack={onClose} onClose={onClose} />
  } else if (view === 'add' && !canUseMultipleLives()) {
    body = <GatePanel t={t} onBack={() => setView('list')} onClose={onClose} />
  } else if ((view === 'add' || view.edit) && edges) {
    const life = view === 'add' ? null : lives.find(l => l.id === view.edit)
    body = (
      <LifeForm
        key={life?.id ?? 'new'}
        life={life}
        edges={edges}
        t={t} tc={tc} language={i18n.language}
        onCancel={() => setView('list')}
        onClose={onClose}
        onSaved={() => { onChanged(); reloadEdges(); setView('list') }}
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
          await forgetLifePhoto(life)
          await deleteLife(life.id)
          reloadEdges()
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

// The picker's option for each type: relationshipParent and so on. (Not
// relationship_<type>: i18next reads a trailing _other as a plural form.)
const relationshipKey = (type) => `relationship${type[0].toUpperCase()}${type.slice(1)}`
// A type this build does not offer (written by a newer one) shows as stored.
const relationshipText = (type, t) => (RELATIONSHIP_TYPES.includes(type) ? t(relationshipKey(type)) : type)

function LifeForm({ life, edges, t, tc, language, onCancel, onClose, onSaved, onBlocked, onDelete }) {
  const isMe = life?.id === ME_LIFE_ID
  // "Relationship to Me": the newest edge from Me to this Life (relationships.js).
  const initialRelationship = life && !isMe ? relationshipToMe(life.id, edges)?.type ?? '' : ''
  const [relationship, setRelationship] = useState(initialRelationship)
  const [name, setName]         = useState(life?.name ?? '')
  const [nickname, setNickname] = useState(life?.nickname ?? '')
  const [about, setAbout]       = useState(life?.about ?? '')
  const [birthDate, setBirth]   = useState(() => (life ? lifeBirthDate(life) ?? '' : ''))
  const [deathDate, setDeath]   = useState(life?.deathDate ?? '')
  const [color, setColor]       = useState(life?.color ?? null)
  const [notes, setNotes]       = useState(life?.notes ?? '')
  const [error, setError]       = useState(null)
  // Photo: a newly picked file (saved after the Life), or a removal.
  const [photoFile, setPhotoFile]       = useState(null)
  const [photoRemoved, setPhotoRemoved] = useState(false)
  const [pickedUrl, setPickedUrl]       = useState(null)
  const storedUrl = useLifePhotoUrl(photoRemoved ? null : life)
  const photoUrl = pickedUrl ?? storedUrl
  const photoRef = useRef(null)
  useEffect(() => () => { if (pickedUrl) URL.revokeObjectURL(pickedUrl) }, [pickedUrl])
  function choosePhoto(file) {
    if (!file) return
    setPhotoFile(file)
    setPhotoRemoved(false)
    setPickedUrl(URL.createObjectURL(file))
  }
  async function openPhotoPicker() {
    const picked = await pickPhotoNative()
    if (picked === null) { photoRef.current?.click(); return }
    if (picked.file) choosePhoto(picked.file)
  }
  function dropPhoto() {
    setPhotoFile(null)
    setPickedUrl(null)
    setPhotoRemoved(true)
    if (photoRef.current) photoRef.current.value = ''
  }

  async function save(e) {
    e.preventDefault()
    if (!isMe && !name.trim()) { setError(t('nameRequired')); return }
    if (birthDate && deathDate && deathDate < birthDate) { setError(t('deathBeforeBirth')); return }
    const fields = { birthDate: birthDate || null, deathDate: deathDate || null, color, notes }
    try {
      let saved
      if (isMe) {
        saved = await updateLife(ME_LIFE_ID, { ...fields, nickname, about }, life)
        // Me's birth date is the birthday setting: let the timeline and the
        // widgets pick it up.
        window.dispatchEvent(new Event('lifeglance:sync-applied'))
        window.dispatchEvent(new Event('lifeglance:widget-refresh'))
      } else if (life) {
        saved = await updateLife(life.id, { ...fields, name }, life)
      } else {
        saved = await createLife({ ...fields, name })
      }
      if (!isMe && relationship !== initialRelationship) {
        await setRelationshipToMe(saved.id, relationship || null, edges)
      }
      if (photoFile) await saveLifePhoto(saved, photoFile)
      else if (photoRemoved && life?.photo_id) await removeLifePhoto(saved)
      onSaved()
    } catch (err) {
      if (err instanceof MultipleLivesBlockedError) onBlocked()
      else setError(err.message)
    }
  }

  return (
    <form className="lives-form" onSubmit={save}>
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

      {!isMe && (
        <div className="sheet-field">
          <label className="field-label" htmlFor="life-relationship">{t('relationshipLabel')}</label>
          <select id="life-relationship" className="input" style={{ cursor: 'pointer' }}
            value={relationship} onChange={e => setRelationship(e.target.value)}>
            <option value="">{t('relationshipNone')}</option>
            {RELATIONSHIP_TYPES.map(type => <option key={type} value={type}>{t(relationshipKey(type))}</option>)}
            {initialRelationship && !RELATIONSHIP_TYPES.includes(initialRelationship) &&
              <option value={initialRelationship}>{initialRelationship}</option>}
          </select>
        </div>
      )}

      <div className="sheet-field">
        <span className="field-label">{t('photoLabel')}</span>
        <div className="lives-photo-row">
          {photoUrl
            ? <img src={photoUrl} alt="" className="life-avatar" style={{ '--life-color': color || 'var(--amber)', width: '3.2rem', height: '3.2rem' }} />
            : null}
          <button type="button" className="btn" style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem' }} onClick={openPhotoPicker}>
            {photoUrl ? tc('replace') : t('addPhoto')}
          </button>
          {photoUrl && <button type="button" className="btn-ghost" style={{ fontSize: '0.72rem' }} onClick={dropPhoto}>{tc('remove')}</button>}
          <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => choosePhoto(e.target.files[0])} />
        </div>
      </div>

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

function GatePanel({ t, footer, onBack, onClose }) {
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
      <p className="lives-intro">{footer ?? t('gateFooter')}</p>
      <div className="sheet-actions">
        <span />
        <div className="sheet-actions-right">
          <button type="button" className="btn" onClick={onBack}>{t('back')}</button>
        </div>
      </div>
    </>
  )
}
