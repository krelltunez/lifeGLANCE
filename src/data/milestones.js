import { dbGetAll, dbAdd, dbPut, dbDelete, dbClearAllMedia } from './db'
import { categoryColor } from '../utils/colors'
import { writeMilestoneTombstone } from '../sync/tombstones'

export function uid() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for non-secure (HTTP) contexts — randomUUID requires HTTPS
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

export function buildMilestone({
  id,
  title,
  date,           // Date object or ISO string
  date_precision = 'month',
  category       = 'personal',
  color,
  note           = '',
  has_photo      = false,
  media_type     = null,   // null | 'audio' | 'video'
  // GLANCEvault forward-compat slots — null until a blob store is wired up
  media_id       = null,   // stable ref for the audio/video blob
  photo_id       = null,   // stable ref for the photo blob
  thumbnail_id   = null,   // reserved; no thumbnail generation yet
  url            = '',
  recurrence     = null,   // null | 'annual'
  recurrence_id  = null,   // UUID shared across instances of a series
  mainTimelineVisibility = 'inherit',
  // dayGLANCE intent linking (Phase 5)
  dayglance_linked       = false,
  dayglance_task_id      = null,
  dayglance_completed    = false,
  dayglance_completed_at = null,
}) {
  const dateObj = date instanceof Date ? date : new Date(date)
  const today   = new Date()
  const now     = new Date().toISOString()

  return {
    id:             id ?? uid(),
    title:          title.trim(),
    date:           dateObj.toISOString(),
    date_precision,
    direction:      dateObj < today ? 'past' : 'future',
    category,
    color:          color || categoryColor(category),
    note,
    has_photo,
    media_type,
    media_id,
    photo_id,
    thumbnail_id,
    url,
    recurrence,
    recurrence_id,
    mainTimelineVisibility,
    dayglance_linked,
    dayglance_task_id,
    dayglance_completed,
    dayglance_completed_at,
    created_at:     now,
    updated_at:     now,
  }
}

export async function loadMilestones() {
  return dbGetAll()
}

export async function addMilestone(data) {
  const m = buildMilestone(data)
  // Stamp reference IDs to match the local blob-key convention so the eventual
  // GLANCEvault cutover is a transport swap with no entity migration.
  if (m.media_type && m.media_id  == null) m.media_id  = m.id
  if (m.has_photo  && m.photo_id  == null) m.photo_id  = `${m.id}-photo`
  await dbAdd(m)
  return m
}

export async function updateMilestone(id, updates, existing) {
  const dateObj = updates.date instanceof Date
    ? updates.date
    : new Date(updates.date || existing.date)

  const today   = new Date()
  const now     = new Date().toISOString()

  // Strip photo_uri from any legacy data still in flight
  const { photo_uri: _discard, ...safeUpdates } = updates

  const m = {
    ...existing,
    ...safeUpdates,
    id,
    date:      dateObj.toISOString(),
    direction: dateObj < today ? 'past' : 'future',
    color:     updates.color || categoryColor(updates.category || existing.category),
    updated_at: now,
  }
  await dbPut(m)
  return m
}

// One-time backfill: stamp media_id / photo_id on existing milestones that
// pre-date the schema addition. Skips milestones that already have values or
// have no media. thumbnail_id intentionally left null for all records.
//
// updated_at is deliberately NOT bumped. Each device runs this backfill
// independently at startup and derives the same deterministic IDs, so sync
// propagation is unnecessary. Bumping would cause a one-time churn where
// every media milestone appears "newer" and triggers a full re-upload.
export async function backfillMediaIds() {
  const all = await dbGetAll()
  for (const m of all) {
    const needsMedia = m.media_type && m.media_id  == null
    const needsPhoto = m.has_photo  && m.photo_id  == null
    if (!needsMedia && !needsPhoto) continue
    await dbPut({
      ...m,
      ...(needsMedia ? { media_id: m.id }             : {}),
      ...(needsPhoto ? { photo_id: `${m.id}-photo` }  : {}),
    })
  }
}

export async function deleteMilestone(id) {
  writeMilestoneTombstone(id)
  await dbDelete(id)
}

// Clear all milestones and replace with the supplied array (preserves original IDs).
// Also wipes all media blobs — they are never included in JSON backups, so any
// media_type / has_photo flags on restored items are reset to stay consistent.
export async function restoreMilestones(items) {
  const existing = await dbGetAll()
  for (const m of existing) await dbDelete(m.id)
  await dbClearAllMedia()
  const clean = items.map(({ photo_uri: _discard, ...m }) => ({
    mainTimelineVisibility: 'inherit',   // default for backups that predate v4
    dayglance_linked:       false,
    dayglance_task_id:      null,
    dayglance_completed:    false,
    dayglance_completed_at: null,
    ...m,
    media_type: null,
    has_photo:  false,
  }))
  for (const m of clean) await dbPut(m)
  return clean
}
