// Lives (v5.0): Life records, which Lives a milestone belongs to, and which Life
// a chapter belongs to. Source of truth: docs/lifeGLANCE-app-spec.md.
//
// Ownership lives inside the records:
//   milestone.lifeOps  { [lifeId]: { op: 'add'|'remove', at } }  an LWW element
//                      set, like chapter memberOps. No lifeOps means Me only.
//   chapter.lifeOps    the same set for a chapter. No lifeOps means Me only. A
//                      chapter holds milestones that share a Life with it.
// So every record written before Lives already belongs to Me, and nothing had
// to be rewritten to introduce them.
//
// Every write marks its row dirty for the GLANCEvault tier, like milestones and
// chapters; the file tier picks Life records up from the store. Membership and
// chapter changes go through updateMilestone / updateChapter.
//
// Adding a Life is gated (lifeGate.js): while a device on an older lifeGLANCE
// has synced in the last 60 days, createLife refuses, so no multi-Life data is
// written that such a device would show as its own.

import { dbGetAllLives, dbGetLife, dbPutLife, dbDeleteLife, dbGetAll, dbGetChapter, dbGetAllChapters, ME_LIFE_ID, ME_LIFE_RECORD } from './db'
import { uid, updateMilestone, deleteMilestone } from './milestones'
import { deleteChapter, removeMilestoneFromChapter, updateChapter } from './chapters'
import { dirtyBirthday, markDirty } from '../sync/dirty'
import { getLifeTombstones, writeLifeTombstone } from '../sync/tombstones'
import { deleteRelationshipsOf } from './relationships'
import { canUseMultipleLives, blockingWriters, MultipleLivesBlockedError } from '../sync/lifeGate'
import { normalizeLifeOps, lifeIdsOf, isInLife, presentLives, normalizeChapterLifeOps, chapterLifeIds, isChapterInLife, canJoinChapter, setLivesOps } from './lifeMembership'

export { ME_LIFE_ID }

export const isMe = (lifeId) => lifeId === ME_LIFE_ID

const BIRTHDAY_KEY    = 'lifeglance-birthday'
const BIRTHDAY_TS_KEY = 'lifeglance-birthday-updated-at'

// The pure membership helpers live in lifeMembership.js so chapters.js can use
// them without an import cycle.
export {
  normalizeLifeOps, lifeIdsOf, isInLife, isShared, milestonesForLife,
  normalizeChapterLifeOps, chapterLifeIds, isChapterInLife, chaptersForLife, canJoinChapter,
} from './lifeMembership'

// ── Changing a milestone's Lives ────────────────────────────────────────────

/**
 * Add a Life to a milestone, or remove one. Records a single op with its own
 * timestamp, never a rewrite of the whole set, so a concurrent change to a
 * different Life on another device survives the merge. Refuses to remove the
 * last Life. Removing a Life also takes the milestone out of every chapter it
 * no longer shares a Life with.
 */
export async function setMilestoneLife(milestone, lifeId, present, { at = new Date().toISOString() } = {}) {
  const before = normalizeLifeOps(milestone)
  if ((before[lifeId]?.op === 'add') === present && milestone.lifeOps) return milestone
  const lifeOps = { ...before, [lifeId]: { op: present ? 'add' : 'remove', at } }
  if (!presentLives(lifeOps).length) throw new Error('A milestone must belong to at least one Life')
  // Pass the colour through: updateMilestone would otherwise reset it to the
  // category's default colour.
  const updated = await updateMilestone(milestone.id, { lifeOps, color: milestone.color }, milestone)
  if (!present) {
    for (const c of await dbGetAllChapters()) {
      if (c.milestoneIds?.includes(milestone.id) && !canJoinChapter(updated, c)) {
        await removeMilestoneFromChapter(c.id, milestone.id)
      }
    }
  }
  return updated
}

// ── Changing a chapter's Lives ──────────────────────────────────────────────

/**
 * The fields that set a chapter's Lives to `lifeIds`, for updateChapter: one
 * op per Life changed, and the members that still share a Life with it (the
 * others leave). `milestones` is the full list (every Life's).
 */
export function chapterLivesUpdate(chapter, lifeIds, milestones, at = new Date().toISOString()) {
  if (!lifeIds.length) throw new Error('A chapter must belong to at least one Life')
  const lifeOps = setLivesOps(normalizeChapterLifeOps(chapter), lifeIds, at)
  const next = { ...chapter, lifeOps }
  const byId = new Map(milestones.map(m => [m.id, m]))
  const milestoneIds = (chapter.milestoneIds ?? []).filter(id => {
    const m = byId.get(id)
    return !m || canJoinChapter(m, next)   // an unknown member is left alone
  })
  return { lifeOps, milestoneIds }
}

/** Add a Life to a chapter, or remove one (refusing the last). */
export async function setChapterLife(chapter, lifeId, present, { at = new Date().toISOString() } = {}) {
  const current = chapterLifeIds(chapter)
  const lifeIds = present ? [...new Set([...current, lifeId])] : current.filter(id => id !== lifeId)
  const fields = chapterLivesUpdate(chapter, lifeIds, await dbGetAll(), at)
  return updateChapter(chapter.id, fields, chapter)
}

export const addLifeToMilestone      = (m, lifeId, opts) => setMilestoneLife(m, lifeId, true, opts)
export const removeLifeFromMilestone = (m, lifeId, opts) => setMilestoneLife(m, lifeId, false, opts)

// ── Life records ────────────────────────────────────────────────────────────

/** Every Life, Me first, then by name. Puts the Me record back if it is missing. */
export async function loadLives() {
  let lives = await dbGetAllLives()
  if (!lives.some(l => isMe(l.id))) {
    await dbPutLife({ ...ME_LIFE_RECORD })
    lives = [{ ...ME_LIFE_RECORD }, ...lives]
  }
  return lives.sort((a, b) => (isMe(a.id) ? -1 : isMe(b.id) ? 1 : (a.name ?? '').localeCompare(b.name ?? '')))
}

export const getLife = (id) => dbGetLife(id)

export function buildLife({ name, nickname = '', about = '', birthDate = null, deathDate = null, color = null, notes = '' }) {
  if (!name || !name.trim()) throw new Error('A Life needs a name')
  const now = new Date().toISOString()
  return {
    id: uid(),
    name: name.trim(),
    nickname,
    about,
    birthDate,
    deathDate,
    photo_id: null,   // reserved: Life photos use the GLANCEvault blob path (Phase 3)
    color,
    notes,
    created_at: now,
    updated_at: now,
  }
}

export async function createLife(data) {
  if (!canUseMultipleLives()) throw new MultipleLivesBlockedError(blockingWriters())
  const life = buildLife(data)
  await dbPutLife(life)
  markDirty(life.id)
  return life
}

/**
 * Update a Life. Me keeps its id and its official name ("Me"); its nickname and
 * about can change. Me's birth date lives in the existing birthday setting, not
 * in the record, so older devices and the widgets keep reading the same value.
 */
export async function updateLife(id, updates, existing) {
  const { id: _id, created_at: _c, ...rest } = updates
  const now = new Date().toISOString()
  if (isMe(id)) {
    const { name: _name, birthDate, ...meUpdates } = rest
    if (birthDate !== undefined) setLifeBirthDate(ME_LIFE_ID, birthDate, now)
    const life = { ...ME_LIFE_RECORD, ...existing, ...meUpdates, id, name: ME_LIFE_RECORD.name, updated_at: now }
    delete life.birthDate
    await dbPutLife(life)
    markDirty(life.id)
    return life
  }
  if ('name' in rest && (!rest.name || !rest.name.trim())) throw new Error('A Life needs a name')
  const life = { ...existing, ...rest, id, updated_at: now }
  if (typeof life.name === 'string') life.name = life.name.trim()
  await dbPutLife(life)
  markDirty(life.id)
  return life
}

/** A Life's birth date (YYYY-MM-DD or null). Me's comes from the birthday setting. */
export function lifeBirthDate(life) {
  if (isMe(life?.id)) {
    try { return localStorage.getItem(BIRTHDAY_KEY) || null } catch { return null }
  }
  return life?.birthDate ?? null
}

function setLifeBirthDate(lifeId, value, at) {
  if (!isMe(lifeId)) return
  localStorage.setItem(BIRTHDAY_KEY, value || '')
  localStorage.setItem(BIRTHDAY_TS_KEY, at)
  dirtyBirthday()
}

// ── Deleting a Life ─────────────────────────────────────────────────────────

export { getLifeTombstones }

/**
 * Delete a Life other than Me. Its milestones that belong to no other Life are
 * deleted; shared milestones only lose this Life. The same for chapters:
 * those only this Life has are deleted, shared ones lose this Life. Every
 * relationship edge that touches it is deleted. Returns what changed so the
 * caller can update its state.
 */
export async function deleteLife(id) {
  if (isMe(id)) throw new Error('The Me Life cannot be deleted')
  const at = new Date().toISOString()
  const deletedMilestoneIds = []
  const updatedMilestones = []
  for (const m of await dbGetAll()) {
    if (!isInLife(m, id)) continue
    if (lifeIdsOf(m).length === 1) {
      await deleteMilestone(m.id)
      deletedMilestoneIds.push(m.id)
    } else {
      updatedMilestones.push(await setMilestoneLife(m, id, false, { at }))
    }
  }
  const deletedChapterIds = []
  const updatedChapters = []
  for (const c of await dbGetAllChapters()) {
    if (!isChapterInLife(c, id)) continue
    if (chapterLifeIds(c).length === 1) {
      await deleteChapter(c.id)
      deletedChapterIds.push(c.id)
    } else {
      // Shared: it stays, without this Life, and without the milestones just
      // deleted. Re-read it: removing this Life from the milestones above may
      // have changed its members.
      const current = await dbGetChapter(c.id) ?? c
      const fields = chapterLivesUpdate(current, chapterLifeIds(current).filter(x => x !== id), await dbGetAll(), at)
      fields.milestoneIds = fields.milestoneIds.filter(mid => !deletedMilestoneIds.includes(mid))
      updatedChapters.push(await updateChapter(c.id, fields, current))
    }
  }
  const deletedRelationshipIds = await deleteRelationshipsOf(id, at)
  writeLifeTombstone(id, at)
  await dbDeleteLife(id)
  // After the row is gone: the vault engine sees no local entity and pushes a
  // soft delete (the same order deleteMilestone uses).
  markDirty(id)
  return { deletedMilestoneIds, updatedMilestones, deletedChapterIds, updatedChapters, deletedRelationshipIds }
}
