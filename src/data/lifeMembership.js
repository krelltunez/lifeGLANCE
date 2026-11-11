// Which Lives a milestone belongs to, and which Life a chapter belongs to.
// Pure and dependency-free (only the Me id), so any data module can use it.
// The rules are explained in lives.js.

import { ME_LIFE_ID } from './db'

export { ME_LIFE_ID }

// ── Which Lives a milestone belongs to ──────────────────────────────────────

/**
 * The milestone's lifeOps, with the implicit Me membership of a pre-Lives
 * record made explicit. The seed uses the record's own creation time, so any
 * later add or remove (on any device) outranks it.
 */
export function normalizeLifeOps(milestone) {
  if (milestone?.lifeOps && typeof milestone.lifeOps === 'object') return { ...milestone.lifeOps }
  const at = milestone?.created_at ?? milestone?.updated_at ?? new Date(0).toISOString()
  return { [ME_LIFE_ID]: { op: 'add', at } }
}

export const presentLives = (ops) => Object.keys(ops).filter(id => ops[id]?.op === 'add').sort()

/**
 * The Lives a milestone belongs to, sorted. A milestone with no lifeOps belongs
 * to Me. One whose every Life was removed (only possible when two devices each
 * remove a different Life at once) also falls back to Me, so it can never
 * become invisible.
 */
export function lifeIdsOf(milestone) {
  if (!milestone?.lifeOps) return [ME_LIFE_ID]
  const ids = presentLives(milestone.lifeOps)
  return ids.length ? ids : [ME_LIFE_ID]
}

export const isInLife = (milestone, lifeId) => lifeIdsOf(milestone).includes(lifeId)
export const isShared = (milestone) => lifeIdsOf(milestone).length > 1

export const milestonesForLife = (milestones, lifeId) => milestones.filter(m => isInLife(m, lifeId))

// ── Which Life a chapter belongs to ─────────────────────────────────────────

export const chapterLifeId = (chapter) => chapter?.lifeId ?? ME_LIFE_ID
export const chaptersForLife = (chapters, lifeId) => chapters.filter(c => chapterLifeId(c) === lifeId)

/** A chapter may hold any milestone of its own Life, shared ones included. */
export const canJoinChapter = (milestone, chapter) => isInLife(milestone, chapterLifeId(chapter))


// ── One Life's view of the full lists ───────────────────────────────────────

/**
 * Apply an update made against one Life's view back onto the full list.
 * `update` is what a React setter takes: the next view, or a function of the
 * current view. Records outside the view are kept as they are, except where
 * the update now carries the same id (a record that moved into the view).
 * The app keeps the full lists because sync must see every Life's records,
 * while each screen works on one Life's.
 */
export function applyScopedUpdate(prev, update, belongs) {
  const view = prev.filter(belongs)
  const next = typeof update === 'function' ? update(view) : update
  const nextIds = new Set(next.map(x => x.id))
  return [...prev.filter(x => !belongs(x) && !nextIds.has(x.id)), ...next]
}

// ── New records in a Life ───────────────────────────────────────────────────

/**
 * The fields that put a new milestone in one Life or several (`lifeIds` is an
 * id or a list). Nothing for Me alone, so a milestone made only in Me is
 * identical to one made before Lives existed.
 */
export function newMilestoneLifeFields(lifeIds, at = new Date().toISOString()) {
  const ids = [...new Set((Array.isArray(lifeIds) ? lifeIds : [lifeIds]).filter(Boolean))]
  if (!ids.length || (ids.length === 1 && ids[0] === ME_LIFE_ID)) return {}
  return { lifeOps: Object.fromEntries(ids.map(id => [id, { op: 'add', at }])) }
}

/** The fields that put a new chapter in `lifeId`. Nothing for Me. */
export function newChapterLifeFields(lifeId) {
  return !lifeId || lifeId === ME_LIFE_ID ? {} : { lifeId }
}

// ── What deleting a Life would do ───────────────────────────────────────────

/**
 * What deleteLife(lifeId) would delete and keep, for the confirmation:
 * milestones only this Life has (deleted), milestones it shares (kept, without
 * it), and its chapters (deleted).
 */
export function deleteLifeImpact(lifeId, milestones, chapters) {
  let only = 0, shared = 0
  for (const m of milestones) {
    if (!isInLife(m, lifeId)) continue
    if (lifeIdsOf(m).length === 1) only++
    else shared++
  }
  return { only, shared, chapters: chaptersForLife(chapters, lifeId).length }
}
