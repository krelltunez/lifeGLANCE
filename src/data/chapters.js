import { dbGetAllChapters, dbGetChapter, dbAddChapter, dbPutChapter, dbDeleteChapter } from './db'
import { uid } from './milestones'
import { writeChapterTombstone } from '../sync/tombstones'
import { markDirty } from '../sync/dirty'

// Valid color values are the same hex strings used for milestone categories and
// the settings palette (COLOR_PALETTE in SettingsModal).  No runtime validation
// here — the caller is responsible for passing a valid palette color.

export function buildChapter({
  title,
  start,
  end = null,
  color,
  category                  = null,   // tag id (same set as milestone categories); null = untagged
  description               = '',
  defaultMemberVisibility   = 'shown',
  parentChapterId           = null,
}) {
  const now = new Date().toISOString()
  return {
    id:                     uid(),
    title:                  title.trim(),
    start:                  start instanceof Date ? start.toISOString() : new Date(start).toISOString(),
    end:                    end === null ? null : (end instanceof Date ? end.toISOString() : new Date(end).toISOString()),
    color,
    category,
    description,
    defaultMemberVisibility,
    parentChapterId,
    milestoneIds:           [],
    // Per-member operation log for multi-device membership merge (Stage 2).
    // `milestoneIds` is a within-entity set that rides the chapter's single
    // `updated_at`, so a plain entity-grain LWW of the chapter would drop one of
    // two concurrent membership edits. memberOps records the last add/remove per
    // member with its own timestamp, turning membership into an LWW-element-set
    // that the GLANCEvault adapter can merge per-member. milestoneIds stays the
    // app-facing source of truth (every consumer uses it as a set); memberOps is
    // maintained alongside it on every membership write.
    memberOps:              {},
    created_at:             now,
    updated_at:             now,
  }
}

// Ensures memberOps covers every current member (seeds an `add` for legacy
// chapters / old backups that predate memberOps), so the membership merge has a
// timestamp for each present member. Pure: returns a fresh memberOps map.
export function normalizeMemberOps(chapter) {
  const ops = { ...(chapter.memberOps ?? {}) }
  const seedAt = chapter.updated_at ?? chapter.created_at ?? new Date(0).toISOString()
  for (const id of chapter.milestoneIds ?? []) {
    if (!ops[id] || ops[id].op !== 'add') ops[id] = { op: 'add', at: ops[id]?.at ?? seedAt }
  }
  return ops
}

// Records the add/remove deltas between an old and new membership list into
// memberOps, stamping each changed member with `at`. Members untouched by this
// edit keep their prior op/timestamp.
function applyMembershipDiff(prevIds, nextIds, prevOps, at) {
  const ops  = { ...(prevOps ?? {}) }
  const prev = new Set(prevIds ?? [])
  const next = new Set(nextIds ?? [])
  for (const id of next) if (!prev.has(id)) ops[id] = { op: 'add', at }
  for (const id of prev) if (!next.has(id)) ops[id] = { op: 'remove', at }
  return ops
}

export async function createChapter(data) {
  const chapter = buildChapter(data)
  await dbAddChapter(chapter)
  markDirty(chapter.id)
  return chapter
}

export async function getChapter(id) {
  return dbGetChapter(id)
}

export async function listChapters() {
  return dbGetAllChapters()
}

export async function updateChapter(id, updates, existing) {
  const now = new Date().toISOString()
  const chapter = {
    ...existing,
    ...updates,
    id,
    updated_at: now,
  }
  // When the membership list is part of this edit, diff it against the prior
  // list so each added/removed member is stamped in memberOps for the merge.
  if ('milestoneIds' in updates) {
    chapter.memberOps = applyMembershipDiff(
      existing?.milestoneIds, updates.milestoneIds, normalizeMemberOps(existing ?? {}), now,
    )
  }
  await dbPutChapter(chapter)
  markDirty(chapter.id)
  return chapter
}

export async function deleteChapter(id) {
  writeChapterTombstone(id)
  await dbDeleteChapter(id)
  markDirty(id)
}

// Adds milestoneId to chapter.milestoneIds; no-op if already present.
export async function addMilestoneToChapter(chapterId, milestoneId) {
  const chapter = await dbGetChapter(chapterId)
  if (!chapter) throw new Error(`Chapter not found: ${chapterId}`)
  if (chapter.milestoneIds.includes(milestoneId)) return chapter
  const now = new Date().toISOString()
  const updated = {
    ...chapter,
    milestoneIds: [...chapter.milestoneIds, milestoneId],
    memberOps:    { ...normalizeMemberOps(chapter), [milestoneId]: { op: 'add', at: now } },
    updated_at:   now,
  }
  await dbPutChapter(updated)
  markDirty(updated.id)
  return updated
}

// Removes milestoneId from chapter.milestoneIds; no-op if not present.
export async function removeMilestoneFromChapter(chapterId, milestoneId) {
  const chapter = await dbGetChapter(chapterId)
  if (!chapter) throw new Error(`Chapter not found: ${chapterId}`)
  const now = new Date().toISOString()
  const updated = {
    ...chapter,
    milestoneIds: chapter.milestoneIds.filter(id => id !== milestoneId),
    memberOps:    { ...normalizeMemberOps(chapter), [milestoneId]: { op: 'remove', at: now } },
    updated_at:   now,
  }
  await dbPutChapter(updated)
  markDirty(updated.id)
  return updated
}

// Returns the milestoneIds array for a chapter.
export async function getMilestonesInChapter(chapterId) {
  const chapter = await dbGetChapter(chapterId)
  if (!chapter) throw new Error(`Chapter not found: ${chapterId}`)
  return chapter.milestoneIds
}

// Returns all chapters that contain the given milestoneId.
export async function getChaptersForMilestone(milestoneId) {
  const chapters = await dbGetAllChapters()
  return chapters.filter(chapter => chapter.milestoneIds.includes(milestoneId))
}

// Replaces all chapter records with the supplied array (used by backup restore).
export async function restoreChapters(items) {
  const existing = await dbGetAllChapters()
  for (const chapter of existing) await dbDeleteChapter(chapter.id)
  // Seed memberOps for any restored chapter that predates the field so its
  // current membership is mergeable after restore.
  const normalized = items.map(c => ({ ...c, memberOps: normalizeMemberOps(c) }))
  for (const chapter of normalized) await dbPutChapter(chapter)
  return normalized
}
