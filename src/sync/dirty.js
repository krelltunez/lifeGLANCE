// markDirty forwarder (Stage 2 Part B).
//
// lifeGLANCE's data layer calls markDirty(entityId) at every local write site
// (the explicit-call-site pattern, like lastGLANCE — lifeGLANCE has discrete
// mutation functions, so this is cleaner than diff-snapshotting). The call is a
// no-op until the GLANCEvault DB engine registers itself as the target, so the
// data layer stays decoupled and the file-tier (WebDAV) build is unaffected.
//
// IMPORTANT: only LOCAL writes go through here. Remote applies (applyRemoteEntity
// in dbAdapter) write to storage DIRECTLY, bypassing this forwarder, so an
// applied remote row is never re-marked dirty — no push loops.

import { bundleEntityId } from './entityIds.js'
import { markLocalEdit } from './localEditStamp.js'

let _target = null

// engine: an object exposing markDirty(entityId). Pass null to unregister.
export function registerDirtyTarget(engine) { _target = engine }

export function markDirty(entityId) {
  if (entityId == null) return
  // Every local write passes here: the Direct Access relay rule reads this
  // stamp (localEditStamp.js), so it is set before the vault target check.
  markLocalEdit()
  if (!_target) return
  try { _target.markDirty(entityId) }
  catch (err) { if (import.meta?.env?.DEV) console.warn('[dbsync] markDirty failed', err) }
}

// Bundle convenience markers.
export const dirtyCategories          = () => markDirty(bundleEntityId('categories'))
export const dirtyBirthday            = () => markDirty(bundleEntityId('birthday'))
export const dirtyMilestoneTombstones = () => markDirty(bundleEntityId('milestoneTombstones'))
export const dirtyChapterTombstones   = () => markDirty(bundleEntityId('chapterTombstones'))
