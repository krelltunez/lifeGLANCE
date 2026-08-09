// Fixed tombstone-retention policy, shared by BOTH sync tiers.
//
// WHY THIS EXISTS (issue #287): lifeGLANCE runs two sync transports over the
// SAME local tombstone maps:
//   (a) the WebDAV file-tier merge (adapter.js mergePayloads), which prunes at
//       a 90-day window it computed FULL-PRECISION per merge, and
//   (b) the vault DB tier (dbAdapter.js mergeTombstoneMap), which was grow-only
//       and NEVER pruned — every deletion ever made lived forever in a
//       singleton bundle that is re-encrypted, re-pushed whole, and re-merged
//       each time it changes.
// Beyond unbounded growth, the mismatch is the dayGLANCE two-transport
// heartbeat waiting to happen: with both tiers enabled, an entry the file tier
// prunes gets re-added by the grow-only vault union, the shared singleton
// flips pruned↔restored across cycles, each flip marks the bundle dirty, each
// push advances the account seq, and under SSE each seq advance nudges the
// next cycle — a continuous self-nudge loop. dayGLANCE hit exactly this and
// landed the pattern this module ports (its tombstoneRetention.js /
// tombstoneHorizon.js): ONE fixed window, applied identically wherever
// tombstones are produced or merged, with the cutoff floored to the UTC day so
// every cycle within a day computes the SAME value and an unchanged bundle
// compares equal.
//
// WHY 90 DAYS: it is the file tier's long-shipped window, so aligning the
// vault tier to it changes no existing pruning behavior. A tombstone only
// needs to outlive the longest realistic gap before a stale device next syncs
// and would otherwise resurrect a deleted item; 90 days covers a device left
// in a drawer for a season. Deliberately NOT user-configurable — coupling the
// window to a user setting is how dayGLANCE's loop started.

const DAY_MS = 24 * 60 * 60 * 1000

export const TOMBSTONE_RETENTION_DAYS = 90

/**
 * Floor an ISO timestamp to the start of its UTC day, as an ISO string.
 * null/undefined/unparseable pass through unchanged. Idempotent.
 */
export function floorToUtcDayIso(iso) {
  if (!iso) return iso
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  return new Date(Math.floor(t / DAY_MS) * DAY_MS).toISOString()
}

/**
 * The day-floored cutoff Date: tombstone entries with a timestamp strictly
 * older than this are eligible for pruning. Flooring to the UTC day keeps the
 * cutoff STABLE across the many sync cycles within a day, so an unchanged
 * bundle merges/produces byte-identically and nothing gets marked dirty — the
 * anti-oscillation property the whole design hangs on.
 *
 * @param {number} [nowMs] current epoch ms (injectable for tests)
 * @returns {Date}
 */
export function tombstoneCutoff(nowMs = Date.now()) {
  const floored = floorToUtcDayIso(new Date(nowMs - TOMBSTONE_RETENTION_DAYS * DAY_MS).toISOString())
  return new Date(floored)
}

/**
 * Drop tombstone entries older than `cutoff`. Absent or unparseable timestamps
 * are KEPT (fail-safe: never lose a tombstone we can't date — losing one risks
 * resurrecting a deleted item, keeping one only costs bytes). Returns a NEW
 * object; a null cutoff returns an unpruned copy.
 *
 * @param {Record<string,string>} map  {id → ISO deletion timestamp}
 * @param {Date|null} cutoff
 * @returns {Record<string,string>}
 */
export function pruneTombstoneMap(map, cutoff) {
  if (!map || typeof map !== 'object') return {}
  if (!cutoff) return { ...map }
  const out = {}
  for (const [id, ts] of Object.entries(map)) {
    const t = new Date(ts).getTime()
    if (Number.isNaN(t) || t >= cutoff.getTime()) out[id] = ts
  }
  return out
}
