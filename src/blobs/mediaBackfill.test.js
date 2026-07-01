import { describe, it, expect } from 'vitest'
import { enumerateBackfillTargets, runMediaBackfill } from './mediaBackfill.js'
import { isRealBlobHash } from './milestoneMedia.js'

// The upload/encrypt/thumbnail path is faked here (proven live + covered by the
// blobTransport / milestoneMedia suites). These tests exercise the backfill's
// OWN logic: enumeration of un-migrated local media, the idempotent/resumable
// run keyed off slot state, per-item failure tolerance, and the summary.

const REAL = (c) => c.repeat(64) // a stand-in 64-hex content hash
const HASH_FULL = REAL('a')
const HASH_THUMB = REAL('b')
const fakeBlob = (n = 4) => ({ arrayBuffer: async () => new Uint8Array(n).buffer })

// Build an in-memory milestone store + injectable deps. `photo`/`media` map a
// milestone id → the mimeType of its LOCAL bytes (absent = no local copy).
// uploadMilestoneMedia is faked: it throws for mimeType 'image/fail' (thumbnail
// failure) and for the first `failNextUpload` calls (flaky/resume), else returns
// real-looking hashes; updateMilestone mutates the store and bumps updated_at.
function harness(milestones, { photo = {}, media = {} } = {}) {
  const store = new Map(milestones.map((m) => [m.id, { ...m }]))
  const calls = { upload: [], update: [] }
  let failNextUpload = 0
  const deps = {
    deriveBlobKey: async () => ({ aesKey: 1, hmacKey: 1 }),
    loadMilestones: async () => [...store.values()].map((m) => ({ ...m })),
    dbGetPhoto: async (id) => (photo[id] ? { blob: fakeBlob(), mimeType: photo[id] } : null),
    dbGetMedia: async (id) => (media[id] ? { blob: fakeBlob(), mimeType: media[id] } : null),
    uploadMilestoneMedia: async ({ mimeType }) => {
      calls.upload.push(mimeType)
      if (failNextUpload > 0) {
        failNextUpload--
        const e = new Error('upload error'); e.name = 'BlobTransportError'; throw e
      }
      if (mimeType === 'image/fail') {
        const e = new Error('bad source'); e.name = 'ThumbnailGenerationError'; throw e
      }
      const visual = mimeType.startsWith('image/') || mimeType.startsWith('video/')
      return { fullHash: HASH_FULL, thumbHash: visual ? HASH_THUMB : null }
    },
    updateMilestone: async (id, updates, existing) => {
      const next = { ...existing, ...updates, updated_at: 'BUMPED' }
      store.set(id, next)
      calls.update.push({ id, updates, existingPhotoId: existing.photo_id })
      return next
    },
  }
  return { deps, store, calls, setFailNextUpload: (n) => { failNextUpload = n } }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const mPhoto = { id: 'm-photo', title: 'Photo', has_photo: true, photo_id: 'm-photo-photo' }
const mAudio = { id: 'm-audio', title: 'Audio', media_type: 'audio', media_id: 'm-audio' }
const mDone = { id: 'm-done', title: 'Done', has_photo: true, photo_id: REAL('c') } // already real
const mRemote = { id: 'm-remote', title: 'Remote', has_photo: true, photo_id: 'm-remote-photo' } // no local
const mBad = { id: 'm-bad', title: 'Bad', has_photo: true, photo_id: 'm-bad-photo' }
const mBoth = { id: 'm-both', title: 'Both', has_photo: true, photo_id: 'm-both-photo', media_type: 'video', media_id: 'm-both' }

describe('mediaBackfill — enumeration', () => {
  it('targets only un-migrated slots whose LOCAL bytes exist on this device', async () => {
    const { deps } = harness(
      [mPhoto, mAudio, mDone, mRemote],
      { photo: { 'm-photo': 'image/jpeg', 'm-done': 'image/jpeg' }, media: { 'm-audio': 'audio/mpeg' } },
    )
    const targets = await enumerateBackfillTargets(deps)
    // m-photo (placeholder + local) and m-audio (placeholder + local). m-done is a
    // real hash already; m-remote is a placeholder with no local copy (held on
    // another device) — both excluded.
    expect(targets.map((t) => t.id).sort()).toEqual(['m-audio', 'm-photo'])
    expect(targets.find((t) => t.id === 'm-photo').photo).toBe(true)
    expect(targets.find((t) => t.id === 'm-audio').media).toBe(true)
  })
})

describe('mediaBackfill — a successful item migrates', () => {
  it('writes real-hash slots (photo + thumbnail) and bumps updated_at', async () => {
    const { deps, store } = harness([mPhoto], { photo: { 'm-photo': 'image/jpeg' } })
    const s = await runMediaBackfill(deps)
    expect(s).toMatchObject({ total: 1, migrated: 1, failed: 0, skipped: 0 })
    const m = store.get('m-photo')
    expect(isRealBlobHash(m.photo_id)).toBe(true)
    expect(isRealBlobHash(m.thumbnail_id)).toBe(true)
    expect(m.updated_at).toBe('BUMPED')
  })

  it('audio migrates a full-res hash with NO thumbnail slot', async () => {
    const { deps, store } = harness([mAudio], { media: { 'm-audio': 'audio/mpeg' } })
    const s = await runMediaBackfill(deps)
    expect(s.migrated).toBe(1)
    const m = store.get('m-audio')
    expect(isRealBlobHash(m.media_id)).toBe(true)
    expect(m.thumbnail_id).toBeUndefined()
  })

  it('a milestone with BOTH photo and video migrates both slots, media built on the photo write', async () => {
    const { deps, store, calls } = harness([mBoth], { photo: { 'm-both': 'image/jpeg' }, media: { 'm-both': 'video/mp4' } })
    await runMediaBackfill(deps)
    const m = store.get('m-both')
    expect(isRealBlobHash(m.photo_id)).toBe(true)
    expect(isRealBlobHash(m.media_id)).toBe(true)
    // Two writes for the same milestone; the media write's `existing` already
    // carries the real photo_id (threaded — no slot clobber).
    const bothUpdates = calls.update.filter((c) => c.id === 'm-both')
    expect(bothUpdates).toHaveLength(2)
    expect(isRealBlobHash(bothUpdates[1].existingPhotoId)).toBe(true)
  })
})

describe('mediaBackfill — idempotent skip', () => {
  it('an already-migrated (real-hash) item is not enumerated and never uploaded', async () => {
    const { deps, calls } = harness([mDone], { photo: { 'm-done': 'image/jpeg' } })
    const s = await runMediaBackfill(deps)
    expect(s.total).toBe(0)
    expect(s.migrated).toBe(0)
    expect(calls.upload).toHaveLength(0)
  })
})

describe('mediaBackfill — per-item failure tolerance', () => {
  it('a failing item is recorded and SKIPPED; the run continues to later items', async () => {
    // Failing item enumerated FIRST to prove it does not halt the run.
    const { deps, store, calls } = harness(
      [mBad, mPhoto],
      { photo: { 'm-bad': 'image/fail', 'm-photo': 'image/jpeg' } },
    )
    const s = await runMediaBackfill(deps)
    expect(s.failed).toBe(1)
    expect(s.migrated).toBe(1)
    expect(s.failures[0]).toMatchObject({ id: 'm-bad', slot: 'photo', title: 'Bad' })
    expect(s.failures[0].reason).toMatch(/ThumbnailGenerationError/)
    // The later item still processed; the failed item stays a local-only placeholder.
    expect(isRealBlobHash(store.get('m-photo').photo_id)).toBe(true)
    expect(isRealBlobHash(store.get('m-bad').photo_id)).toBe(false)
    expect(calls.upload).toHaveLength(2) // both attempted
  })
})

describe('mediaBackfill — resumable', () => {
  it('re-running after a partial run processes ONLY the remainder', async () => {
    const { deps, store, setFailNextUpload } = harness(
      [mPhoto, mAudio],
      { photo: { 'm-photo': 'image/jpeg' }, media: { 'm-audio': 'audio/mpeg' } },
    )
    setFailNextUpload(1) // fail the first upload (m-photo); m-audio still succeeds
    const s1 = await runMediaBackfill(deps)
    expect(s1.migrated).toBe(1) // audio done
    expect(s1.failed).toBe(1) // photo failed
    expect(isRealBlobHash(store.get('m-photo').photo_id)).toBe(false)
    expect(isRealBlobHash(store.get('m-audio').media_id)).toBe(true)

    // Re-run: audio is now a real hash (excluded); only the photo remains.
    const s2 = await runMediaBackfill(deps)
    expect(s2.total).toBe(1)
    expect(s2.migrated).toBe(1)
    expect(isRealBlobHash(store.get('m-photo').photo_id)).toBe(true)
  })
})

describe('mediaBackfill — progress, cancel, and key pre-flight', () => {
  it('reports progress from 0 to total', async () => {
    const progress = []
    const { deps } = harness(
      [mPhoto, mAudio],
      { photo: { 'm-photo': 'image/jpeg' }, media: { 'm-audio': 'audio/mpeg' } },
    )
    await runMediaBackfill({ ...deps, onProgress: (p) => progress.push(p) })
    expect(progress[0]).toEqual({ done: 0, total: 2 })
    expect(progress[progress.length - 1]).toEqual({ done: 2, total: 2 })
  })

  it('stops cooperatively at an item boundary (resumable) when shouldStop() turns true', async () => {
    const { deps, store } = harness(
      [mPhoto, mAudio],
      { photo: { 'm-photo': 'image/jpeg' }, media: { 'm-audio': 'audio/mpeg' } },
    )
    let checks = 0
    const s = await runMediaBackfill({ ...deps, shouldStop: () => checks++ >= 1 }) // allow item 0, stop before item 1
    expect(s.stopped).toBe(true)
    expect(s.migrated).toBe(1)
    expect(isRealBlobHash(store.get('m-audio').media_id)).toBe(false) // never reached
  })

  it('bails immediately with keyUnavailable when the blob key cannot be derived', async () => {
    const { deps, calls } = harness([mPhoto], { photo: { 'm-photo': 'image/jpeg' } })
    const s = await runMediaBackfill({ ...deps, deriveBlobKey: async () => null })
    expect(s.keyUnavailable).toBe(true)
    expect(s.total).toBe(0)
    expect(calls.upload).toHaveLength(0)
  })

  it('calls onMilestoneUpdated only for milestones whose slots changed', async () => {
    const updated = []
    const { deps } = harness([mPhoto], { photo: { 'm-photo': 'image/jpeg' } })
    await runMediaBackfill({ ...deps, onMilestoneUpdated: (m) => updated.push(m.id) })
    expect(updated).toEqual(['m-photo'])
  })
})
