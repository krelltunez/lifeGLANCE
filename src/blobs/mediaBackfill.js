// =============================================================================
// mediaBackfill — migrate EXISTING local-only milestone media to GLANCEvault
// (Phase 8 media, step 2). USER-INITIATED, idempotent, resumable, per-item safe.
// =============================================================================
//
// New attachments already blob-round-trip (TimelineView.establishVaultMediaRefs).
// This migrates the EXISTING library: media that currently lives only in the
// local IndexedDB media store (photos keyed `${id}-photo`, audio/video keyed
// `${id}`) with PLACEHOLDER reference slots, so it becomes visible cross-device.
//
// It runs the SAME proven single-media path — uploadMilestoneMedia (thumbnail →
// upload full + thumb with HEAD-dedup → ref-add) → write the REAL-hash slots via
// updateMilestone (which BUMPS updated_at so the now-non-deterministic hashes
// propagate by LWW). It does NOT reimplement upload/encrypt/thumbnail, and it
// NEVER touches the local media store — local stays as the source and fallback.
//
// IDEMPOTENT: a real 64-hex slot is skipped (isRealBlobHash); content-addressing
// + the HEAD existence check inside uploadBlob mean an already-stored blob is not
// re-uploaded. Safe to run repeatedly.
//
// RESUMABLE with NO separate progress state: the real-hash slot written by
// updateMilestone IS the durable "done" marker. A re-run re-enumerates from the
// current (persisted) milestone state, so only slots still on placeholders are
// processed — an interruption resumes from where it left off.
//
// PER-ITEM FAILURE TOLERANCE: one bad item (thumbnail generation fails on a
// corrupt/unsupported source, or an upload error) is recorded with its reason and
// SKIPPED; the run continues to the next item. Failed items stay local-only
// (unchanged placeholders) and are retried on a later run.

import { loadMilestones as _loadMilestones, updateMilestone as _updateMilestone } from '../data/milestones.js'
import { dbGetPhoto as _dbGetPhoto, dbGetMedia as _dbGetMedia } from '../data/db.js'
import { uploadMilestoneMedia as _uploadMilestoneMedia, isRealBlobHash } from './milestoneMedia.js'
import { deriveBlobKey as _deriveBlobKey } from './blobCrypto.js'

// A slot needs backfill when the milestone flags media present but the reference
// slot is still a local-only placeholder (the milestone id / `${id}-photo`),
// never a real 64-hex content hash.
function photoNeedsBackfill(m) { return !!m.has_photo && !isRealBlobHash(m.photo_id) }
function mediaNeedsBackfill(m) { return !!m.media_type && !isRealBlobHash(m.media_id) }

function reasonOf(err) {
  const name = err?.name || 'Error'
  const message = err?.message || String(err)
  return `${name}: ${message}`
}

/**
 * Enumerate the milestones with local media not yet on the vault. A slot is a
 * target only when (a) its placeholder flags it un-migrated AND (b) its bytes
 * actually exist in the LOCAL store on this device — a placeholder slot with no
 * local copy is media held on another device (that device must migrate it), so
 * it's excluded to keep the progress total honest.
 *
 * @returns {Promise<Array<{ id, milestone, photo: boolean, media: boolean }>>}
 */
export async function enumerateBackfillTargets(deps = {}) {
  const loadMilestones = deps.loadMilestones ?? _loadMilestones
  const dbGetPhoto = deps.dbGetPhoto ?? _dbGetPhoto
  const dbGetMedia = deps.dbGetMedia ?? _dbGetMedia

  const milestones = await loadMilestones()
  const targets = []
  for (const m of milestones) {
    const wantPhoto = photoNeedsBackfill(m)
    const wantMedia = mediaNeedsBackfill(m)
    if (!wantPhoto && !wantMedia) continue
    const photo = wantPhoto && !!(await dbGetPhoto(m.id))
    const media = wantMedia && !!(await dbGetMedia(m.id))
    if (photo || media) targets.push({ id: m.id, milestone: m, photo, media })
  }
  return targets
}

// Migrate ONE slot: read local bytes → run the proven upload path → write the
// real-hash slot(s). Returns a per-slot result; never throws (the caller relies
// on that for skip-and-continue).
async function backfillSlot(milestone, slot, deps) {
  const dbGetPhoto = deps.dbGetPhoto ?? _dbGetPhoto
  const dbGetMedia = deps.dbGetMedia ?? _dbGetMedia
  const uploadMilestoneMedia = deps.uploadMilestoneMedia ?? _uploadMilestoneMedia
  const updateMilestone = deps.updateMilestone ?? _updateMilestone
  try {
    const rec = slot === 'photo' ? await dbGetPhoto(milestone.id) : await dbGetMedia(milestone.id)
    if (!rec || !rec.blob) return { slot, status: 'skipped', reason: 'no local media on this device' }
    const bytes = new Uint8Array(await rec.blob.arrayBuffer())
    const { fullHash, thumbHash } = await uploadMilestoneMedia({ bytes, mimeType: rec.mimeType })
    const updates = slot === 'photo' ? { photo_id: fullHash } : { media_id: fullHash }
    if (thumbHash) updates.thumbnail_id = thumbHash
    const updated = await updateMilestone(milestone.id, updates, milestone)
    return { slot, status: 'migrated', milestone: updated }
  } catch (err) {
    return { slot, status: 'failed', reason: reasonOf(err) }
  }
}

// Process a single milestone's flagged slots. Photo then media, threading the
// updated milestone so the media write builds on the photo write (no slot
// clobber) — identical to the live backgroundEstablishMedia chaining. Re-checks
// slot state against the CURRENT object so a resumed run never re-uploads a slot
// that has already become a real hash.
async function backfillTarget(target, deps) {
  let current = target.milestone
  const results = []
  if (target.photo && photoNeedsBackfill(current)) {
    const r = await backfillSlot(current, 'photo', deps)
    results.push(r)
    if (r.milestone) current = r.milestone
  }
  if (target.media && mediaNeedsBackfill(current)) {
    const r = await backfillSlot(current, 'media', deps)
    results.push(r)
    if (r.milestone) current = r.milestone
  }
  return { milestone: current, results, changed: current !== target.milestone }
}

/**
 * Run the backfill over all un-migrated local media, one item at a time.
 *
 * @param {object} deps
 *   - onProgress({ done, total })   progress callback (milestone-grained)
 *   - onMilestoneUpdated(milestone) called after a milestone's slots are written
 *   - shouldStop() => boolean       cooperative cancel checked at each item boundary
 *   (plus injectable loadMilestones/dbGetPhoto/dbGetMedia/uploadMilestoneMedia/
 *    updateMilestone/deriveBlobKey for tests)
 * @returns summary {
 *   keyUnavailable, total, migrated, failed, skipped, stopped, failures:[{id,title,slot,reason}]
 * }
 *   Counts are SLOT-grained (a milestone with a photo + a video is two units);
 *   `total`/progress are milestone-grained.
 */
export async function runMediaBackfill(deps = {}) {
  const deriveBlobKey = deps.deriveBlobKey ?? _deriveBlobKey
  const onProgress = deps.onProgress ?? (() => {})
  const onMilestoneUpdated = deps.onMilestoneUpdated ?? (() => {})
  const shouldStop = deps.shouldStop ?? (() => false)

  const summary = { keyUnavailable: false, total: 0, migrated: 0, failed: 0, skipped: 0, stopped: false, failures: [] }

  // Pre-flight: the blob key must be derivable, or EVERY item would throw
  // BlobKeyUnavailableError. Bail with a clear signal instead of churning the
  // whole library. (On a device where new attachments already blob-round-trip,
  // the key is present — this guards the fresh-household / key-not-ready case.)
  const key = await deriveBlobKey()
  if (!key) { summary.keyUnavailable = true; return summary }

  const targets = await enumerateBackfillTargets(deps)
  summary.total = targets.length
  onProgress({ done: 0, total: summary.total })

  for (let i = 0; i < targets.length; i++) {
    if (shouldStop()) { summary.stopped = true; break }
    const { milestone, results, changed } = await backfillTarget(targets[i], deps)
    for (const r of results) {
      if (r.status === 'migrated') summary.migrated++
      else if (r.status === 'skipped') summary.skipped++
      else {
        summary.failed++
        summary.failures.push({ id: targets[i].id, title: targets[i].milestone.title, slot: r.slot, reason: r.reason })
      }
    }
    if (changed) onMilestoneUpdated(milestone)
    onProgress({ done: i + 1, total: summary.total })
  }
  return summary
}
