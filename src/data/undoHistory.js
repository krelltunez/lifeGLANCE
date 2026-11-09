// Undo / redo history for milestones.
//
// Each entry is the DELTA one user action made, not a snapshot of the whole
// timeline:
//
//   { added: Milestone[], removed: Milestone[], changed: [{ id, before, after }] }
//
// Undo applies the inverse of the entry, redo applies the entry, and both go
// through the ordinary data-layer writes (updateMilestone / deleteMilestone /
// reinstateMilestone) so every step marks the row dirty, bumps updated_at for
// LWW, and writes a tombstone on delete, exactly like the original action did.
//
// Why a delta and not a snapshot: the old snapshot approach replayed a whole
// timeline through restoreMilestones, which is the backup-restore path. That
// wiped the media store, stripped has_photo / media_type from every milestone,
// bypassed sync dirty-marking, and reverted anything that arrived from another
// device (or from dayGLANCE) after the snapshot was taken. A delta touches only
// the milestones and fields the undone action touched.
//
// Attachments are deliberately outside the history. Their bytes are not
// versioned, so undo can never bring back an overwritten or removed photo; if
// it restored the reference fields anyway, the milestone would point at media
// that no longer exists. Bookkeeping fields are recomputed on write.

import { dbGet } from './db'
import { updateMilestone, deleteMilestone, reinstateMilestone } from './milestones'

export const MAX_HISTORY = 50

// Fields an undo step never writes back.
const IGNORED_FIELDS = new Set([
  // attachments: bytes are not in the history (see above)
  'has_photo', 'media_type', 'media_id', 'photo_id', 'thumbnail_id',
  // bookkeeping: recomputed by the data layer on every write
  'updated_at', 'created_at', 'direction',
  // colour always tracks the category's current colour, derived on apply
  'color',
])

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)

// The change one action made, from the timeline as it was just before the
// action to the timeline just after it. Returns null when nothing undoable
// changed (e.g. an edit that only replaced a photo).
export function diffMilestones(before, after) {
  const beforeById = new Map(before.map(m => [m.id, m]))
  const afterById  = new Map(after.map(m => [m.id, m]))
  const added   = after.filter(m => !beforeById.has(m.id))
  const removed = before.filter(m => !afterById.has(m.id))
  const changed = []
  for (const a of after) {
    const b = beforeById.get(a.id)
    if (!b || b === a) continue
    const keys = new Set([...Object.keys(b), ...Object.keys(a)])
    const fb = {}, fa = {}
    for (const k of keys) {
      if (IGNORED_FIELDS.has(k) || same(b[k], a[k])) continue
      fb[k] = b[k]
      fa[k] = a[k]
    }
    if (Object.keys(fa).length) changed.push({ id: a.id, before: fb, after: fa })
  }
  if (!added.length && !removed.length && !changed.length) return null
  return { added, removed, changed }
}

export function invertEntry(entry) {
  return {
    added:   entry.removed,
    removed: entry.added,
    changed: entry.changed.map(c => ({ id: c.id, before: c.after, after: c.before })),
  }
}

const defaultDeps = {
  get:       dbGet,
  update:    updateMilestone,
  remove:    deleteMilestone,
  reinstate: reinstateMilestone,
}

// Apply one entry against the CURRENT stored state. Each part is skipped when
// the state has already moved on (the milestone was deleted, or re-created, on
// another device in the meantime) rather than forced.
//
// colorFor(categoryId) → the user's current colour for that category, or
// undefined to keep the stored colour.
//
// Returns { removed, reinstated, updated }: removed holds the records as they
// were in storage at removal, which is the version a later re-creation must
// use; reinstated (re-created after a delete) and updated (fields patched) hold
// the records as written.
export async function applyEntry(entry, { colorFor = () => undefined, ...overrides } = {}) {
  const deps = { ...defaultDeps, ...overrides }
  const removed = []
  const reinstated = []
  const updated = []

  for (const m of entry.removed) {
    const current = await deps.get(m.id)
    if (!current) continue
    await deps.remove(m.id)
    removed.push(current)
  }

  for (const m of entry.added) {
    if (await deps.get(m.id)) continue
    const color = colorFor(m.category) ?? m.color
    reinstated.push(await deps.reinstate({ ...m, color }))
  }

  for (const c of entry.changed) {
    const current = await deps.get(c.id)
    if (!current) continue
    const category = c.after.category ?? current.category
    const color = colorFor(category) ?? current.color
    updated.push(await deps.update(c.id, { ...c.after, color }, current))
  }

  return { removed, reinstated, updated }
}

// ── History stack ────────────────────────────────────────────────────────────
// entries[0 .. idx-1] are applied (undoable); entries[idx ..] are redoable.

export const createHistory = () => ({ entries: [], idx: 0 })

export const canUndo = (h) => h.idx > 0
export const canRedo = (h) => h.idx < h.entries.length

export function record(h, entry) {
  if (!entry) return
  h.entries = h.entries.slice(0, h.idx)  // a new action discards redo history
  h.entries.push(entry)
  if (h.entries.length > MAX_HISTORY) h.entries.shift()
  h.idx = h.entries.length
}

// Swap in the records as they were when a step removed them, so the step that
// later re-creates them brings back the latest version (including media slots
// a background upload established after the action was recorded), not the
// version captured when the action was first recorded.
function refresh(list, removed) {
  if (!removed.length) return list
  const byId = new Map(removed.map(m => [m.id, m]))
  return list.map(m => byId.get(m.id) ?? m)
}

export async function undo(h, opts) {
  if (!canUndo(h)) return null
  const entry = h.entries[h.idx - 1]
  const result = await applyEntry(invertEntry(entry), opts)
  // Undo removed entry.added; redo re-creates them.
  entry.added = refresh(entry.added, result.removed)
  h.idx--
  return result
}

export async function redo(h, opts) {
  if (!canRedo(h)) return null
  const entry = h.entries[h.idx]
  const result = await applyEntry(entry, opts)
  // Redo removed entry.removed; undo re-creates them.
  entry.removed = refresh(entry.removed, result.removed)
  h.idx++
  return result
}

// Fold a step's result into an in-memory milestones array.
export function applyResult(milestones, { removed, reinstated, updated }) {
  const upserted = [...reinstated, ...updated]
  const gone = new Set(removed.map(m => m.id))
  const byId = new Map(upserted.map(m => [m.id, m]))
  const kept = milestones
    .filter(m => !gone.has(m.id))
    .map(m => byId.get(m.id) ?? m)
  const present = new Set(kept.map(m => m.id))
  return [...kept, ...upserted.filter(m => !present.has(m.id))]
}
