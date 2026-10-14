// When this device itself last changed its data.
//
// The Direct Access cycle (directAccessCycle.js) writes a change made HERE to
// the folder at once, and a change that reached this device by another road
// (GLANCEvault, WebDAV) only after the file has sat unchanged without it for
// RELAY_CONFIRM_MS, so the originating device's own write gets there first and
// two devices do not write the same data on top of each other (dayGLANCE's
// docs/direct-access-sync.md, "Relay rules"). "Made here" is this stamp being
// newer than this device's last write to the file.
//
// The data layer stamps it through dirty.js markDirty on every write of the
// app's own (milestones, chapters, tombstones, categories), BEFORE the
// GLANCEvault target check, so it is set with or without a vault. The vault
// apply writes to storage directly and never passes through there; the file
// tier's apply does reach saveCategories, which marks dirty, so the engine
// wraps that apply in withoutLocalEditStamp. Device-local, never synced.
//
// Ported from lastGLANCE (src/sync/localEditStamp.ts).

export const LOCAL_EDIT_KEY = 'lifeglance-local-edit-at'

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage)

let suppressed = 0

export function markLocalEdit(now = Date.now) {
  if (suppressed > 0) return
  try { storage()?.setItem(LOCAL_EDIT_KEY, new Date(now()).toISOString()) } catch { /* private mode / quota */ }
}

export function lastLocalEditAt() {
  try { return storage()?.getItem(LOCAL_EDIT_KEY) ?? null } catch { return null }
}

/**
 * Wraps an apply so the writes it makes through the data layer do not count
 * as edits made here. Re-entrant: nested applies keep the stamp held until
 * the outermost one settles.
 */
export function withoutLocalEditStamp(fn) {
  return async (...args) => {
    suppressed += 1
    try { return await fn(...args) }
    finally { suppressed -= 1 }
  }
}
