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

// ── Which Lives a chapter belongs to ────────────────────────────────────────
// The same LWW element set as a milestone's (`lifeOps`). A chapter with no
// lifeOps belongs to Me. Before chapters could be shared (a lives-v5 build that
// never shipped), a chapter had a single `lifeId`; it is still read here, as
// that one Life, and replaced by lifeOps on the chapter's next write.

/** The chapter's lifeOps, with the implicit membership made explicit. */
export function normalizeChapterLifeOps(chapter) {
  if (chapter?.lifeOps && typeof chapter.lifeOps === 'object') return { ...chapter.lifeOps }
  const at = chapter?.created_at ?? chapter?.updated_at ?? new Date(0).toISOString()
  return { [chapter?.lifeId ?? ME_LIFE_ID]: { op: 'add', at } }
}

/** The Lives a chapter belongs to, sorted; Me if none is present. */
export function chapterLifeIds(chapter) {
  if (!chapter?.lifeOps) return [chapter?.lifeId ?? ME_LIFE_ID]
  const ids = presentLives(chapter.lifeOps)
  return ids.length ? ids : [ME_LIFE_ID]
}

export const isChapterInLife = (chapter, lifeId) => chapterLifeIds(chapter).includes(lifeId)
export const chaptersForLife = (chapters, lifeId) => chapters.filter(c => isChapterInLife(c, lifeId))

/**
 * A chapter may hold a milestone that shares at least one Life with it. (A
 * Me + Mom chapter may hold a milestone that is only Me's; each Life's view
 * shows only its own milestones.)
 */
export const canJoinChapter = (milestone, chapter) => chapterLifeIds(chapter).some(id => isInLife(milestone, id))


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

/**
 * A record's lifeOps after setting its Lives to `lifeIds`: one op per Life
 * that changes (dated `at`), every other op kept as it was. `ops` is the
 * normalized current set (normalizeLifeOps / normalizeChapterLifeOps).
 */
export function setLivesOps(ops, lifeIds, at = new Date().toISOString()) {
  const want = new Set(lifeIds)
  const out = { ...ops }
  for (const id of want) if (out[id]?.op !== 'add') out[id] = { op: 'add', at }
  for (const id of presentLives(ops)) if (!want.has(id)) out[id] = { op: 'remove', at }
  return out
}

/** The fields that put a new chapter in one Life or several. Nothing for Me alone. */
export function newChapterLifeFields(lifeIds, at = new Date().toISOString()) {
  return newMilestoneLifeFields(lifeIds, at)
}

// ── What deleting a Life would do ───────────────────────────────────────────

/**
 * What deleteLife(lifeId) would delete and keep, for the confirmation:
 * milestones and chapters only this Life has (deleted), and those it shares
 * (kept, without it).
 */
export function deleteLifeImpact(lifeId, milestones, chapters) {
  let only = 0, shared = 0, chaptersOnly = 0, chaptersShared = 0
  for (const m of milestones) {
    if (!isInLife(m, lifeId)) continue
    if (lifeIdsOf(m).length === 1) only++
    else shared++
  }
  for (const c of chapters) {
    if (!isChapterInLife(c, lifeId)) continue
    if (chapterLifeIds(c).length === 1) chaptersOnly++
    else chaptersShared++
  }
  return { only, shared, chapters: chaptersOnly, chaptersShared }
}
