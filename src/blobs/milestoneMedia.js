// =============================================================================
// milestoneMedia — wire milestone media to the GLANCEvault blob store (Phase 8.1)
// =============================================================================
//
// Points the reserved milestone reference slots (media_id / photo_id /
// thumbnail_id) at REAL content-addressed blob hashes, and resolves them back to
// bytes for display. New-attachment path + display path only — NOT a backfill of
// existing local media (that's a separate step).
//
// Building blocks (Phase 7, native-safe): blobTransport.uploadBlob (HEAD-dedup +
// resumable, idempotent), downloadBlob, addBlobRef/releaseBlobRef; thumbnail
// .generateThumbnail. All injectable via `deps` so this is unit-testable with the
// faked native primitive / fake image processor the Phase 7 modules already use.
//
// INVARIANTS:
//  • BLOBS-BEFORE-REFERENCE: the full-res blob AND its thumbnail are uploaded and
//    confirmed stored BEFORE the caller writes any reference slot. uploadBlob is
//    idempotent (HEAD-dedup), so a retry after a partial failure is safe.
//  • NO REFERENCE TO A THUMBNAIL THAT WASN'T MADE: thumbnail generation runs
//    FIRST; if it throws, we abort before any upload or ref — nothing is written.
//  • The CALLER writes the returned slot hashes via updateMilestone(), which
//    bumps updated_at — real hashes are not device-derivable, so the change must
//    propagate via LWW (unlike the old deterministic backfill, which did not bump).

import {
  uploadBlob as _uploadBlob,
  downloadBlob as _downloadBlob,
  addBlobRef as _addBlobRef,
  releaseBlobRef as _releaseBlobRef,
} from './blobTransport.js'
import { generateThumbnail as _generateThumbnail, sourceKind } from './thumbnail.js'

// A real blob slot is a lowercase 64-hex SHA-256. The legacy placeholders are the
// milestone id (`<uuid>`) or `<uuid>-photo` — never 64 hex — so this cleanly
// distinguishes a vault-backed slot from a local-only one.
const HASH_RE = /^[0-9a-f]{64}$/
export function isRealBlobHash(value) {
  return typeof value === 'string' && HASH_RE.test(value)
}

/**
 * Upload a milestone's media bytes (+ a thumbnail for image/video) to the vault
 * and reference-count them. Returns `{ fullHash, thumbHash }` (thumbHash is null
 * for audio, which has no visual thumbnail). The caller writes these to the slots
 * ONLY after this resolves.
 *
 * Ordering: generate thumbnail → upload full → upload thumb → ref-add both. A
 * throw at any step leaves NOTHING referenced (uploads are idempotent on retry).
 *
 * @throws {import('./thumbnail.js').ThumbnailGenerationError} bad/corrupt source — before any upload.
 * @throws {import('./blobCrypto.js').BlobKeyUnavailableError} no vault key yet — before any network write.
 * @throws on any upload / ref failure (caller treats as "reference not established yet", retriable).
 */
export async function uploadMilestoneMedia({ bytes, mimeType }, deps = {}) {
  const uploadBlob = deps.uploadBlob ?? _uploadBlob
  const generateThumbnail = deps.generateThumbnail ?? _generateThumbnail
  const addBlobRef = deps.addBlobRef ?? _addBlobRef

  const kind = sourceKind(mimeType)
  const wantsThumb = kind === 'image' || kind === 'video'

  // 1. Thumbnail FIRST — if it can't be made, abort before any upload/reference.
  let thumb = null
  if (wantsThumb) thumb = await generateThumbnail(bytes, mimeType)

  // 2. Upload both blobs, confirm stored, BEFORE the caller writes any slot.
  const fullHash = await uploadBlob(bytes)
  const thumbHash = thumb ? await uploadBlob(thumb.bytes) : null

  // 3. Reference-count on the server (feeds eventual reclaim).
  await addBlobRef(fullHash)
  if (thumbHash) await addBlobRef(thumbHash)

  return { fullHash, thumbHash }
}

/**
 * Release server references for a milestone's REAL-hash slots (delete path).
 * Releasing a reference is not deleting a blob — it lets the server's ref count
 * drop toward eventual reclaim. Best-effort and idempotent; placeholders are
 * ignored. Returns the unique hashes it released.
 */
export async function releaseMilestoneMedia(milestone, deps = {}) {
  const releaseBlobRef = deps.releaseBlobRef ?? _releaseBlobRef
  const hashes = [milestone?.photo_id, milestone?.media_id, milestone?.thumbnail_id].filter(isRealBlobHash)
  const unique = [...new Set(hashes)]
  for (const h of unique) {
    try {
      await releaseBlobRef(h)
    } catch (err) {
      // Best-effort: a failed release just delays reclaim; never block the delete.
      if (import.meta?.env?.DEV) console.warn('[media] releaseBlobRef failed (non-fatal):', err)
    }
  }
  return unique
}

// ── Display: decrypted-thumbnail cache (timeline re-render) ──────────────────
// Keyed by content hash. A content address is immutable, so a decrypted thumbnail
// can be cached for the session and never re-fetched. Failures are NOT cached, so
// a missing blob re-fetches next time (self-heal once a holder re-uploads).
const _thumbCache = new Map()

/**
 * Fetch + decrypt a thumbnail by its blob hash, cached in memory. Returns null
 * for a non-real-hash (legacy/local) slot. Rejects only on a genuine fetch/
 * decrypt failure — callers render the missing-media placeholder on rejection.
 */
export function fetchThumbnailBytes(hash, deps = {}) {
  if (!isRealBlobHash(hash)) return Promise.resolve(null)
  if (_thumbCache.has(hash)) return _thumbCache.get(hash)
  const downloadBlob = deps.downloadBlob ?? _downloadBlob
  const p = downloadBlob(hash).then(
    (bytes) => { _thumbCache.set(hash, Promise.resolve(bytes)); return bytes },
    (err) => { _thumbCache.delete(hash); throw err },
  )
  _thumbCache.set(hash, p)
  return p
}

export function clearThumbnailCache() {
  _thumbCache.clear()
}

/**
 * Fetch + decrypt full-res photo / video bytes by hash (lazy, uncached — large).
 * Returns null for a non-real-hash slot. Rejects on fetch/decrypt failure.
 */
export function fetchFullResBytes(hash, deps = {}) {
  if (!isRealBlobHash(hash)) return Promise.resolve(null)
  const downloadBlob = deps.downloadBlob ?? _downloadBlob
  return downloadBlob(hash)
}
