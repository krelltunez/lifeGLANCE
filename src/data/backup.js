// The JSON backup: "Save backup" and "Restore" in Settings (Lives v5.0, Phase 5a).
// docs/lifeGLANCE-app-spec.md, "Decided in Phase 5a".
//
// One flat JSON file. Format 2 (v5.0) holds every Life's data:
//   milestones, chapters          every Life's, not just the one on screen
//   photos                        milestone id → data URI
//   categories, categoriesUpdatedAt, birthday, birthdayUpdatedAt
//   lifeRecords                   every Life; Me's carries its birthDate
//   relationships                 every edge
//   lifePhotos                    Life id → data URI
// Older files (a bare milestone array, or format 1 without `format`) still
// restore: they replace milestones and chapters and leave Lives alone.
//
// Restore replaces. It is refused while an older device has synced in the last
// 60 days if the file holds any Life but Me (the Lives gate, lifeGate.js).

import { dbGetAll, dbPut, dbGetAllChapters, dbGetAllLives, dbPutLife, dbDeleteLife, dbGetPhoto, dbPutPhoto,
  dbGetAllRelationships, dbPutRelationship, dbDeleteRelationship, ME_LIFE_ID, ME_LIFE_RECORD } from './db'
import { restoreMilestones } from './milestones'
import { restoreChapters } from './chapters'
import { lifeIdsOf, chapterLifeId } from './lifeMembership'
import { loadCategories, saveCategories } from '../utils/colors'
import { dirtyBirthday } from '../sync/dirty'
import { canUseMultipleLives, blockingWriters, MultipleLivesBlockedError } from '../sync/lifeGate'
import { isRealBlobHash, fetchFullResBytes } from '../blobs/milestoneMedia.js'

export const BACKUP_FORMAT = 2

const BIRTHDAY_KEY    = 'lifeglance-birthday'
const BIRTHDAY_TS_KEY = 'lifeglance-birthday-updated-at'
const CATS_TS_KEY     = 'lifeglance-categories-updated-at'

// A blob-backed photo slot carries no stored mime type (the encrypted bytes are
// opaque). For a backup data-URI the declared mime matters — restore reads it
// back from the header — so sniff the image type from the magic bytes rather than
// mislabel it. Falls back to JPEG (the capture default) for anything unrecognized.
export function sniffImageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp'
  return 'image/jpeg'
}

const toDataUri = (bytes, mimeType) =>
  `data:${mimeType};base64,${btoa([...bytes].map(b => String.fromCharCode(b)).join(''))}`

function fromDataUri(dataUri) {
  const [header, b64] = dataUri.split(',')
  const mimeType = header.match(/:(.*?);/)[1]
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return { blob: new Blob([arr], { type: mimeType }), mimeType }
}

// The photo stored under `id` (a milestone's or a Life's), as a data URI. The
// local copy first; a photo synced from another device lives only as a vault
// blob (`photoId` is a real hash), so that is fetched and decrypted, or a backup
// made on the receiving device would silently omit every synced-in photo.
async function photoDataUri(id, photoId) {
  try {
    const local = await dbGetPhoto(id)
    if (local) return toDataUri(new Uint8Array(await local.blob.arrayBuffer()), local.mimeType)
    if (isRealBlobHash(photoId)) {
      const b = await fetchFullResBytes(photoId)
      if (b) return toDataUri(b, sniffImageMime(b))
    }
  } catch { /* unreadable photo: left out */ }
  return null
}

/** Everything a backup holds, read from the stores (never from React state). */
export async function buildBackup() {
  const [milestones, chapters, lives, relationships] = await Promise.all([
    dbGetAll(), dbGetAllChapters(), dbGetAllLives(), dbGetAllRelationships(),
  ])
  const birthday = localStorage.getItem(BIRTHDAY_KEY) || ''

  const photos = {}
  for (const m of milestones) {
    if (!m.has_photo) continue
    const uri = await photoDataUri(m.id, m.photo_id)
    if (uri) photos[m.id] = uri
  }
  const lifePhotos = {}
  for (const l of lives) {
    if (!l.photo_id) continue
    const uri = await photoDataUri(l.id, l.photo_id)
    if (uri) lifePhotos[l.id] = uri
  }
  // Me's birth date is the birthday setting, not a record field; the file
  // carries it on the record too, for matching on import (Phase 5b).
  const lifeRecords = lives.map(l => (l.id === ME_LIFE_ID && birthday ? { ...l, birthDate: birthday } : l))

  return {
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    milestones,
    photos,
    chapters,
    categories: loadCategories(),
    categoriesUpdatedAt: localStorage.getItem(CATS_TS_KEY) || '',
    // Settings worth preserving across a restore (mirrors the cloud-sync payload
    // in sync/adapter.js, which already carried these).
    birthday,
    birthdayUpdatedAt: localStorage.getItem(BIRTHDAY_TS_KEY) || '',
    lifeRecords,
    relationships,
    lifePhotos,
  }
}

/**
 * Read a parsed backup file into one shape, whatever its age. Throws on a file
 * that cannot be restored.
 */
export function readBackup(parsed) {
  if (Array.isArray(parsed)) return { milestones: parsed, photos: {}, chapters: [], lifeRecords: null, relationships: null, lifePhotos: {} }
  if (!parsed || typeof parsed !== 'object') throw new Error('This file is not a lifeGLANCE backup.')
  // Backups with an 'eras' key instead of 'chapters' are from a pre-rename dev
  // build and are not supported.
  if (Array.isArray(parsed.eras) && !Array.isArray(parsed.chapters)) {
    throw new Error('This backup was created before the Chapters rename and cannot be imported. Please regenerate the backup from the app.')
  }
  if (!Array.isArray(parsed.milestones)) throw new Error('This file is not a lifeGLANCE backup.')
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
  return {
    milestones: parsed.milestones,
    photos: obj(parsed.photos),
    chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
    categories: Array.isArray(parsed.categories) && parsed.categories.length > 0 ? parsed.categories : null,
    categoriesUpdatedAt: parsed.categoriesUpdatedAt || '',
    birthday: typeof parsed.birthday === 'string' && parsed.birthday ? parsed.birthday : null,
    birthdayUpdatedAt: parsed.birthdayUpdatedAt || '',
    // null = the file predates Lives: leave this device's Lives as they are.
    lifeRecords: Array.isArray(parsed.lifeRecords) ? parsed.lifeRecords : null,
    relationships: Array.isArray(parsed.relationships) ? parsed.relationships : null,
    lifePhotos: obj(parsed.lifePhotos),
  }
}

/** Whether restoring `backup` (from readBackup) would bring in any Life but Me. */
export function backupHasOtherLives(backup) {
  if (backup.lifeRecords?.some(l => l?.id !== ME_LIFE_ID)) return true
  if (backup.relationships?.length) return true
  if (backup.milestones.some(m => lifeIdsOf(m).some(id => id !== ME_LIFE_ID))) return true
  return backup.chapters.some(c => chapterLifeId(c) !== ME_LIFE_ID)
}

/**
 * Replace this device's data with `backup` (from readBackup). Returns the
 * restored milestones and chapters, and the birthday if the file set one.
 */
export async function restoreBackup(backup) {
  if (backupHasOtherLives(backup) && !canUseMultipleLives()) {
    throw new MultipleLivesBlockedError(blockingWriters())
  }

  // restoreMilestones clears the whole media store, Life photos included. A
  // file without Lives leaves them as they are, so keep their photos.
  const keptLifePhotos = []
  if (!backup.lifeRecords) {
    for (const l of await dbGetAllLives()) {
      const p = await dbGetPhoto(l.id).catch(() => null)
      if (p) keptLifePhotos.push([l.id, p])
    }
  }

  const milestones = await restoreMilestones(backup.milestones)
  const chapters = await restoreChapters(backup.chapters)

  // Milestone photos back into the media store.
  for (const m of milestones) {
    const uri = backup.photos[m.id]
    if (!uri) continue
    try {
      const { blob, mimeType } = fromDataUri(uri)
      await dbPutPhoto(m.id, blob, mimeType)
      m.has_photo = true
      await dbPut(m)
    } catch { /* malformed data URI: skipped */ }
  }

  if (backup.categories) {
    saveCategories(backup.categories)
    if (backup.categoriesUpdatedAt) localStorage.setItem(CATS_TS_KEY, backup.categoriesUpdatedAt)
  }
  if (backup.birthday) {
    localStorage.setItem(BIRTHDAY_KEY, backup.birthday)
    localStorage.setItem(BIRTHDAY_TS_KEY, backup.birthdayUpdatedAt || new Date().toISOString())
    dirtyBirthday()
  }

  if (backup.lifeRecords) {
    const fileIds = new Set(backup.lifeRecords.map(l => l.id))
    for (const l of await dbGetAllLives()) {
      if (l.id !== ME_LIFE_ID && !fileIds.has(l.id)) await dbDeleteLife(l.id)
    }
    for (const l of backup.lifeRecords) {
      if (!l?.id) continue
      if (l.id === ME_LIFE_ID) {
        // Me keeps its fixed identity; its birth date is the birthday setting.
        const { birthDate: _birthDate, ...rest } = l
        await dbPutLife({ ...rest, id: ME_LIFE_ID, name: ME_LIFE_RECORD.name })
      } else {
        await dbPutLife(l)
      }
    }
    for (const [id, uri] of Object.entries(backup.lifePhotos)) {
      if (!fileIds.has(id)) continue
      try { const { blob, mimeType } = fromDataUri(uri); await dbPutPhoto(id, blob, mimeType) } catch { /* skipped */ }
    }
  } else {
    for (const [id, p] of keptLifePhotos) await dbPutPhoto(id, p.blob, p.mimeType)
  }

  if (backup.relationships) {
    for (const e of await dbGetAllRelationships()) await dbDeleteRelationship(e.id)
    for (const e of backup.relationships) if (e?.id) await dbPutRelationship(e)
  }

  return { milestones, chapters, birthday: backup.birthday }
}
