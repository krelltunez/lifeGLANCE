// Import and merge (Lives v5.0, Phase 5b): add someone's backup or shared file to
// this device's data instead of replacing it. docs/lifeGLANCE-app-spec.md,
// "Decided before Phase 5b" and "Decided in Phase 5b".
//
// 1. planImport(backup, lives) suggests what to do with each Life in the file:
//      • the same Life id as one here: match it;
//      • otherwise a Life here with the same name AND birth date: match it;
//      • otherwise: add it as a new Life.
//    The exporter's Me is never matched by id (it is someone else's Me) and
//    starts as Skip. A Life is never matched on name alone.
// 2. The user changes any row: match to any Life here, add as new, or skip.
// 3. applyImport(backup, decisions) writes the result. It only adds:
//      • a milestone both sides have (same id) merges as sync merges it;
//        others are added; one that belongs only to skipped Lives is left out;
//      • chapters follow their Life;
//      • relationships are joined, with each Life id mapped to the Life it was
//        matched to; an edge equal to one here (from, to, type) is dropped;
//      • a matched Life keeps its own fields; the file fills only empty ones;
//      • tombstones in the file are ignored.
//    Every write is marked for sync. Refused by the Lives gate when the result
//    would involve any Life but Me while an older device is active.

import { dbGetAll, dbPut, dbGetAllChapters, dbPutChapter, dbGetAllLives, dbGetLife, dbPutLife, dbPutPhoto,
  dbGetAllRelationships, dbPutRelationship, ME_LIFE_ID } from './db'
import { uid } from './milestones'
import { normalizeMemberOps } from './chapters'
import { normalizeLifeOps, presentLives, chapterLifeId } from './lifeMembership'
import { mergeMilestones, mergeChapters, mergeMemberOps } from '../sync/dbAdapter'
import { markDirty, dirtyBirthday } from '../sync/dirty'
import { getMilestoneTombstones, getChapterTombstones, getRelationshipTombstones } from '../sync/tombstones'
import { canUseMultipleLives, blockingWriters, MultipleLivesBlockedError } from '../sync/lifeGate'
import { loadCategories, saveCategories } from '../utils/colors'
import { fromDataUri } from './backup'

const BIRTHDAY_KEY    = 'lifeglance-birthday'
const BIRTHDAY_TS_KEY = 'lifeglance-birthday-updated-at'

const norm = (s) => String(s ?? '').trim().toLocaleLowerCase()

/** The Lives in the file, Me first. */
export function fileLives(backup) {
  // A file from before Lives holds only Me. (A shared file may hold no Me.)
  const records = Array.isArray(backup.lifeRecords)
    ? backup.lifeRecords.filter(l => l?.id)
    : [{ id: ME_LIFE_ID, name: 'Me', ...(backup.birthday ? { birthDate: backup.birthday } : {}) }]
  return [...records.filter(l => l.id === ME_LIFE_ID), ...records.filter(l => l.id !== ME_LIFE_ID)]
}

// What a Life here is called and when it was born, for matching. Me's birth
// date is the birthday setting.
const localBirthDate = (l) => (l.id === ME_LIFE_ID ? localStorage.getItem(BIRTHDAY_KEY) || null : l.birthDate || null)

/**
 * A suggested decision for every Life in the file: { [fileLifeId]:
 * { action: 'match', targetId } | { action: 'new', name } | { action: 'skip' } }.
 */
export function planImport(backup, localLivesList) {
  const plan = {}
  for (const f of fileLives(backup)) {
    if (f.id === ME_LIFE_ID) { plan[f.id] = { action: 'skip' }; continue }
    if (localLivesList.some(l => l.id === f.id)) { plan[f.id] = { action: 'match', targetId: f.id }; continue }
    const same = f.birthDate && localLivesList.find(l =>
      l.id !== ME_LIFE_ID && norm(l.name) === norm(f.name) && localBirthDate(l) === f.birthDate)
    plan[f.id] = same ? { action: 'match', targetId: same.id } : { action: 'new', name: f.name ?? '' }
  }
  return plan
}

// File Life id → the id it gets here, or null when skipped.
function idMapOf(backup, decisions, localIds) {
  const map = {}
  for (const f of fileLives(backup)) {
    const d = decisions[f.id] ?? { action: 'skip' }
    if (d.action === 'match') map[f.id] = d.targetId
    else if (d.action === 'new') map[f.id] = f.id !== ME_LIFE_ID && !localIds.has(f.id) ? f.id : uid()
    else map[f.id] = null
  }
  return map
}

// The file milestone's Lives, mapped. null when it belongs only to skipped Lives.
function mapLifeOps(m, map) {
  const out = {}
  for (const [id, op] of Object.entries(normalizeLifeOps(m))) {
    const to = map[id]
    if (!to) continue
    out[to] = out[to] ? mergeMemberOps({ [to]: out[to] }, { [to]: op })[to] : op
  }
  return presentLives(out).length ? out : null
}

// A record this device deleted (a tombstone here) would be deleted again by the
// next file-tier merge, which lets a tombstone beat an older record. An import
// is a new write, so it is dated now.
function freshIfTombstoned(rec, tombstones, now) {
  return tombstones[rec.id] ? { ...rec, updated_at: now } : rec
}

const sameEdge = (a, b) => a.fromLifeId === b.fromLifeId && a.toLifeId === b.toLifeId && a.type === b.type

/**
 * What applyImport would do, for the preview: counts of milestones added,
 * merged and left out; chapters added and merged; relationships added.
 */
export async function previewImport(backup, decisions) {
  return runImport(backup, decisions, { dryRun: true })
}

export async function applyImport(backup, decisions) {
  return runImport(backup, decisions, { dryRun: false })
}

async function runImport(backup, decisions, { dryRun }) {
  const now = new Date().toISOString()
  const localLives = await dbGetAllLives()
  const localIds = new Set(localLives.map(l => l.id))
  const map = idMapOf(backup, decisions, localIds)

  // The gate: refused if the result involves any Life but Me.
  const touchesOthers = Object.values(map).some(id => id && id !== ME_LIFE_ID)
  if (!dryRun && touchesOthers && !canUseMultipleLives()) throw new MultipleLivesBlockedError(blockingWriters())

  const counts = { milestonesAdded: 0, milestonesMerged: 0, milestonesLeftOut: 0, chaptersAdded: 0, chaptersMerged: 0,
    relationshipsAdded: 0, livesAdded: 0 }

  // ── Lives ──
  for (const f of fileLives(backup)) {
    const d = decisions[f.id] ?? { action: 'skip' }
    const to = map[f.id]
    if (!to) continue
    if (d.action === 'new') {
      counts.livesAdded++
      if (dryRun) continue
      // A new Life is a new write here (dated now), so a Life this device
      // deleted earlier, coming back under the same id, is kept by sync.
      const { photo_id: _p, thumbnail_id: _t, ...fields } = f
      const life = { ...fields, id: to, name: (d.name ?? '').trim() || f.name || '', created_at: f.created_at ?? now, updated_at: now }
      const photo = backup.lifePhotos?.[f.id]
      if (photo) {
        try { const p = fromDataUri(photo); await dbPutPhoto(to, p.blob, p.mimeType); life.photo_id = `${to}-photo` } catch { /* skipped */ }
      }
      await dbPutLife(life)
      markDirty(to)
    } else if (d.action === 'match' && !dryRun) {
      await fillLife(to, f, backup.lifePhotos?.[f.id], now)
    }
  }

  // ── Categories: add any the file's milestones use that this device lacks ──
  const fileCats = Array.isArray(backup.categories) ? backup.categories : []
  const cats = loadCategories()
  const missingCats = fileCats.filter(c => c?.id && !cats.some(x => x.id === c.id))

  // ── Milestones ──
  const localMs = new Map((await dbGetAll()).map(m => [m.id, m]))
  const mTomb = getMilestoneTombstones()
  const imported = new Set()
  const usedCats = new Set()
  for (const fm of backup.milestones) {
    if (!fm?.id) continue
    const ops = mapLifeOps(fm, map)
    if (!ops) { counts.milestonesLeftOut++; continue }
    imported.add(fm.id)
    usedCats.add(fm.category)
    // Belonging only to Me, as a record with no lifeOps does: leave it that way.
    const onlyMe = !fm.lifeOps && Object.keys(ops).length === 1 && ops[ME_LIFE_ID]
    const { lifeOps: _o, photo_uri: _u, ...rest } = fm
    const remapped = onlyMe ? rest : { ...rest, lifeOps: ops }
    const local = localMs.get(fm.id)
    if (local) {
      counts.milestonesMerged++
      if (dryRun) continue
      // The local photo, media and links stay as they are.
      const merged = mergeMilestones(local, { ...remapped, has_photo: local.has_photo, photo_id: local.photo_id,
        thumbnail_id: local.thumbnail_id, media_type: local.media_type, media_id: local.media_id })
      await dbPut(merged)
      markDirty(merged.id)
    } else {
      counts.milestonesAdded++
      if (dryRun) continue
      // Someone else's links and media do not come along; the photo does, as a
      // local copy (their vault references are not readable here).
      let m = freshIfTombstoned({
        ...remapped,
        dayglance_linked: false, dayglance_task_id: null, dayglance_completed: false, dayglance_completed_at: null,
        media_type: null, media_id: null, has_photo: false, photo_id: null, thumbnail_id: null,
      }, mTomb, now)
      const photo = backup.photos?.[fm.id]
      if (photo) {
        try { const p = fromDataUri(photo); await dbPutPhoto(m.id, p.blob, p.mimeType); m = { ...m, has_photo: true, photo_id: `${m.id}-photo` } } catch { /* skipped */ }
      }
      await dbPut(m)
      markDirty(m.id)
    }
  }
  if (!dryRun) {
    const add = missingCats.filter(c => usedCats.has(c.id))
    if (add.length) saveCategories([...cats, ...add])
  }

  // ── Chapters: follow their Life ──
  const localCs = new Map((await dbGetAllChapters()).map(c => [c.id, c]))
  const cTomb = getChapterTombstones()
  const present = new Set([...localMs.keys(), ...imported])
  for (const fc of backup.chapters ?? []) {
    if (!fc?.id) continue
    const to = map[chapterLifeId(fc)]
    if (!to) continue
    const local = localCs.get(fc.id)
    local ? counts.chaptersMerged++ : counts.chaptersAdded++
    if (dryRun) continue
    // Members this device does not have (left out) are dropped.
    const ops = Object.fromEntries(Object.entries(normalizeMemberOps(fc)).filter(([id]) => present.has(id)))
    const { lifeId: _l, ...rest } = fc
    const remapped = { ...rest, ...(to === ME_LIFE_ID ? {} : { lifeId: to }), memberOps: ops,
      milestoneIds: Object.keys(ops).filter(id => ops[id].op === 'add') }
    const next = local ? mergeChapters(local, remapped) : freshIfTombstoned(remapped, cTomb, now)
    await dbPutChapter(next)
    markDirty(next.id)
  }

  // ── Relationships: joined, with Life ids mapped ──
  const localEdges = await dbGetAllRelationships()
  const rTomb = getRelationshipTombstones()
  for (const fe of backup.relationships ?? []) {
    if (!fe?.id) continue
    const from = map[fe.fromLifeId], to = map[fe.toLifeId]
    if (!from || !to || from === to) continue
    const edge = { ...fe, fromLifeId: from, toLifeId: to }
    const same = localEdges.find(e => e.id === fe.id)
    if (same) {
      if (!dryRun && String(edge.updated_at) > String(same.updated_at)) { await dbPutRelationship(edge); markDirty(edge.id) }
      continue
    }
    if (localEdges.some(e => sameEdge(e, edge))) continue
    counts.relationshipsAdded++
    localEdges.push(edge)
    if (dryRun) continue
    const next = freshIfTombstoned(edge, rTomb, now)
    await dbPutRelationship(next)
    markDirty(next.id)
  }

  return counts
}

// A matched Life: its own fields win; the file fills only the empty ones.
async function fillLife(id, f, photoUri, now) {
  const life = await dbGetLife(id)
  if (!life) return
  const FIELDS = ['nickname', 'about', 'deathDate', 'color', 'notes', ...(id === ME_LIFE_ID ? [] : ['birthDate'])]
  const fill = {}
  for (const k of FIELDS) if (!life[k] && f[k]) fill[k] = f[k]
  if (id === ME_LIFE_ID && f.birthDate && !localStorage.getItem(BIRTHDAY_KEY)) {
    localStorage.setItem(BIRTHDAY_KEY, f.birthDate)
    localStorage.setItem(BIRTHDAY_TS_KEY, now)
    dirtyBirthday()
  }
  if (!life.photo_id && photoUri) {
    try { const p = fromDataUri(photoUri); await dbPutPhoto(id, p.blob, p.mimeType); fill.photo_id = `${id}-photo` } catch { /* skipped */ }
  }
  if (!Object.keys(fill).length) return
  await dbPutLife({ ...life, ...fill, updated_at: now })
  markDirty(id)
}
