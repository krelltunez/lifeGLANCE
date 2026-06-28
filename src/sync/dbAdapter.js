// GLANCEvault database-transport adapter for lifeGLANCE (Stage 2).
//
// The file-tier transport (adapter.js) ships the whole `lives.default` bundle as
// one encrypted blob and merges it with mergePayloads(). The database transport
// (@glance-apps/sync createDbSyncEngine) instead exchanges one encrypted row per
// entity and merges entity-by-entity. This module is the data-shape-agnostic
// glue between lifeGLANCE's stores and that engine: the engine callbacks
// (getLocalEntity / applyRemoteEntity / applyRemoteDelete / isInsertOnly /
// getEntityLastModified) plus the per-bundle merge logic.
//
// ── Entity → row mapping ────────────────────────────────────────────────────
//   milestone   → row, entityId = milestone.id     (per-item, plain LWW)
//   chapter     → row, entityId = chapter.id        (per-item, MERGE-on-apply)
//   categories          → one bundle row            (MERGE-on-apply)
//   milestoneTombstones → one bundle row            (MERGE-on-apply)
//   chapterTombstones   → one bundle row            (MERGE-on-apply)
//   birthday            → one bundle row            (LWW scalar)
//
// Discrimination (Stage 1, spec 5.2): every envelope carries an explicit `_kind`
// (and an in-envelope `life_id`). entityIds for milestones/chapters are their
// own bare UUIDs (no type leak in the row key); bundle rows use stable, NON
// engine-reserved ids (`life:<lifeId>:<kind>` — the `__glance_` prefix is owned
// by the engine). Milestone and chapter UUIDs never collide, so getLocalEntity
// resolves a bare id by probing both stores; `_kind` routes applyRemoteEntity.
//
// ── Why chapters and bundles are "merge-on-apply" ───────────────────────────
// The engine does entity-grain LWW for normal rows: on pull it only calls
// applyRemoteEntity when the remote row wins (or local is absent). That is right
// for milestones (flat records) but WRONG for any entity that hides a mergeable
// set: it would drop one of two concurrent edits. So chapters (membership set)
// and every bundle (maps / arrays) are reported as `isInsertOnly`, which makes
// the engine ALWAYS call applyRemoteEntity; we then merge against the local copy
// inside. When a merge leaves this device richer than the row the peer pushed,
// we markDirty(entityId) so the merged SUPERSET is re-pushed next cycle — the
// dayGLANCE convergence mechanism. All merges are monotone joins (union / max /
// per-member LWW), so they converge in one extra round.

import { normalizeMemberOps } from '../data/chapters.js'
import { LIFE_ID, BUNDLE_KINDS, bundleEntityId } from './entityIds.js'

export { LIFE_ID, BUNDLE_KINDS, bundleEntityId }

const BUNDLE_ID_TO_KIND = Object.fromEntries(BUNDLE_KINDS.map(k => [bundleEntityId(k), k]))
export const isBundleEntityId = (entityId) => entityId in BUNDLE_ID_TO_KIND

const ts = (v) => {
  if (v == null) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

// Strip the routing metadata the wire adds, recovering the stored payload shape.
const stripEnvelope = (env) => {
  const { _kind, life_id, ...rest } = env // eslint-disable-line no-unused-vars
  return rest
}

// ── Bundle merge strategies (the Stage 2 fixes) ─────────────────────────────

// CATEGORIES (spec 5.3 whole-array LWW hazard → per-id union).
// A single `categoriesUpdatedAt` covers the whole array, so there are no
// per-key timestamps. Rule:
//   • UNION by category id — a different-id add/edit on either device is never
//     dropped (this is the A1 fix).
//   • SAME id edited on both → the array with the newer categoriesUpdatedAt wins
//     for that id (whole-bundle LWW tiebreak; documented, deterministic).
//   • Order/winner are a pure function of (arrays, timestamps), independent of
//     which side is "local", so both devices converge to byte-identical output:
//     the newer array is the base (its order + its values for shared ids), then
//     older-only ids are appended in the older array's order.
// Known non-loss caveat: with no category tombstones, a concurrent delete (one
// device) vs edit (other) RESURRECTS the deleted category — annoyance, not data
// loss, and deletion is allowed only for unused categories. Flagged in the table.
export function mergeCategories(localArr, localTs, remoteArr, remoteTs) {
  const a = Array.isArray(localArr) ? localArr : []
  const b = Array.isArray(remoteArr) ? remoteArr : []
  const lt = ts(localTs), rt = ts(remoteTs)

  // Pick the global "newer" side deterministically (commutative tiebreak on a
  // timestamp tie: more entries, then lexicographically smaller serialization).
  let newer, older
  if (rt > lt) { newer = b; older = a }
  else if (lt > rt) { newer = a; older = b }
  else {
    const pick = (b.length !== a.length)
      ? (b.length > a.length ? b : a)
      : (JSON.stringify(b) < JSON.stringify(a) ? b : a)
    newer = pick; older = pick === b ? a : b
  }

  const merged = [...newer]
  const seen = new Set(newer.map(c => c.id))
  for (const cat of older) if (!seen.has(cat.id)) { merged.push(cat); seen.add(cat.id) }

  return { categories: merged, categoriesUpdatedAt: rt >= lt ? (remoteTs || localTs || '') : (localTs || '') }
}

// TOMBSTONE MAPS (A3 — don't regress the existing per-key merge).
// id → ISO. UNION keeping the latest ISO per key (commutative). Different-id
// tombstones from two devices both survive; same-id keeps the later stamp.
export function mergeTombstoneMap(localMap, remoteMap) {
  const out = { ...(localMap && typeof localMap === 'object' ? localMap : {}) }
  const r = remoteMap && typeof remoteMap === 'object' ? remoteMap : {}
  for (const [id, iso] of Object.entries(r)) {
    if (!(id in out) || ts(iso) > ts(out[id])) out[id] = iso
  }
  return out
}

// CHAPTER MEMBERSHIP (A2 — within-entity set hazard → LWW-element-set).
// memberOps is { milestoneId: { op:'add'|'remove', at } }. Merge per member by
// the larger `at` (a tie resolves to 'remove' so a concurrent add/remove at the
// exact same instant never resurrects a removed member — deterministic and
// commutative). The present membership (milestoneIds) is DERIVED from the merged
// ops: a member is present iff its winning op is 'add'. This means:
//   • concurrent add(A) / add(B) on one chapter → both present (the A2 fix);
//   • concurrent add+remove of the SAME member → latest timestamp wins, so a
//     removal is never resurrected by the peer's stale set, and an add after a
//     remove is never dropped;
//   • a removal carries its own timestamp, so a stale member list on the peer
//     cannot undo it (the classic "set-union resurrects removed members" bug).
// milestoneIds is canonicalised (sorted) so both devices converge byte-identical
// — order is irrelevant to the app (every consumer treats it as a set).
export function mergeMemberOps(localOps, remoteOps) {
  const out = { ...(localOps ?? {}) }
  for (const [id, rop] of Object.entries(remoteOps ?? {})) {
    const lop = out[id]
    if (!lop) { out[id] = rop; continue }
    if (ts(rop.at) > ts(lop.at)) out[id] = rop
    else if (ts(rop.at) === ts(lop.at) && rop.op === 'remove') out[id] = rop
  }
  return out
}
const presentMembers = (memberOps) =>
  Object.keys(memberOps).filter(id => memberOps[id].op === 'add').sort()

// Merge two chapter versions. Scalar fields use entity-grain LWW by updated_at
// (concurrent edits to a chapter's scalar fields remain LWW — same accepted
// caveat as milestones, out of Stage-2 scope); membership uses the LWW-element-
// set above. updated_at becomes the max of the two.
export function mergeChapters(local, remote) {
  const newerScalars = ts(remote.updated_at) >= ts(local.updated_at) ? remote : local
  const memberOps = mergeMemberOps(normalizeMemberOps(local), normalizeMemberOps(remote))
  return {
    ...newerScalars,
    memberOps,
    milestoneIds: presentMembers(memberOps),
    updated_at: ts(remote.updated_at) >= ts(local.updated_at) ? remote.updated_at : local.updated_at,
  }
}

// ── Adapter factory ─────────────────────────────────────────────────────────
// `store` abstracts the per-device persistence so the same adapter runs over the
// real db.js + localStorage (Part B) and over in-memory maps (the two-device
// harness). `markDirty(entityId)` is the engine's dirty-tracker (late-bound).
//
// store interface:
//   milestones: { get(id)→m|null, put(m), delete(id), all()→[m] }
//   chapters:   { get(id)→c|null, put(c), delete(id), all()→[c] }
//   getBundle(kind)→repr | putBundle(kind, repr)
//     categories          repr: { value:[...], updatedAt }
//     birthday            repr: { value:'', updatedAt }
//     milestone/chapterTombstones repr: { value:{ id:iso } }
// Canonical (key-order-independent) deep equality. The re-push-superset check
// MUST be order-insensitive: a merged object legitimately equal to the peer's
// row but with different key order would otherwise look "richer", re-push every
// cycle, and clobber the peer's superset before it reads it — non-convergence.
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = canonical(v[k])
    return out
  }
  return v
}
const sameContent = (x, y) => JSON.stringify(canonical(x)) === JSON.stringify(canonical(y))

export function makeDbAdapter({ store, markDirty = () => {} }) {
  const deepEqual = sameContent

  // Store ops may be async (real db.js / localStorage) or sync (the in-memory
  // harness); awaiting works for both. Callbacks the engine awaits are async.

  // ── Bundle envelope <-> repr ──
  const bundleEnvelope = async (kind) => {
    const repr = await store.getBundle(kind)
    const env = { _kind: kind, life_id: LIFE_ID, value: repr.value }
    if ('updatedAt' in repr) env.updatedAt = repr.updatedAt
    return env
  }
  const applyBundle = async (kind, env) => {
    const local = await store.getBundle(kind)
    let mergedRepr
    if (kind === 'categories') {
      const m = mergeCategories(local.value, local.updatedAt, env.value, env.updatedAt)
      mergedRepr = { value: m.categories, updatedAt: m.categoriesUpdatedAt }
    } else if (kind === 'milestoneTombstones' || kind === 'chapterTombstones') {
      mergedRepr = { value: mergeTombstoneMap(local.value, env.value) }
    } else if (kind === 'birthday') {
      const remoteWins = ts(env.updatedAt) >= ts(local.updatedAt)
      mergedRepr = remoteWins
        ? { value: env.value, updatedAt: env.updatedAt }
        : { value: local.value, updatedAt: local.updatedAt }
    } else {
      throw new Error(`unknown bundle kind: ${kind}`)
    }
    await store.putBundle(kind, mergedRepr)
    // Re-push the superset if this device's local copy contributed anything the
    // peer's row lacked (i.e. merged != what remote pushed).
    if (!deepEqual(mergedRepr.value, env.value) ||
        ('updatedAt' in env && mergedRepr.updatedAt !== env.updatedAt)) {
      markDirty(bundleEntityId(kind))
    }
  }

  // ── Engine callbacks ──
  const getLocalEntity = async (entityId) => {
    if (isBundleEntityId(entityId)) return bundleEnvelope(BUNDLE_ID_TO_KIND[entityId])
    const m = await store.milestones.get(entityId)
    if (m) return { _kind: 'milestone', life_id: LIFE_ID, ...m }
    const c = await store.chapters.get(entityId)
    if (c) return { _kind: 'chapter', life_id: LIFE_ID, ...c }
    return null
  }

  const applyRemoteEntity = async (entityId, env) => {
    const kind = env?._kind
    if (kind === 'milestone') {
      // Plain LWW already resolved by the engine — remote won (or local absent).
      await store.milestones.put(stripEnvelope(env))
      return
    }
    if (kind === 'chapter') {
      const remoteChapter = stripEnvelope(env)
      const local = await store.chapters.get(entityId)
      if (!local) { await store.chapters.put({ ...remoteChapter, memberOps: normalizeMemberOps(remoteChapter) }); return }
      const merged = mergeChapters(local, remoteChapter)
      await store.chapters.put(merged)
      // Richer-than-remote → re-push the merged superset.
      if (!deepEqual({ ...merged, _kind: 'chapter', life_id: LIFE_ID }, env)) markDirty(entityId)
      return
    }
    if (BUNDLE_ID_TO_KIND[entityId]) { await applyBundle(BUNDLE_ID_TO_KIND[entityId], env); return }
    if (BUNDLE_KINDS.includes(kind)) { await applyBundle(kind, env); return }
    throw new Error(`applyRemoteEntity: unroutable row ${entityId} (_kind=${kind})`)
  }

  const applyRemoteDelete = async (entityId) => {
    // Bundles are never deleted. A bare-UUID delete is a milestone or a chapter;
    // delete from both stores (the wrong one is a harmless no-op).
    if (isBundleEntityId(entityId)) return
    await store.milestones.delete(entityId)
    await store.chapters.delete(entityId)
  }

  // Chapters and bundles are merge-on-apply: report insert-only so the engine
  // always routes them to applyRemoteEntity instead of doing its own LWW.
  const isInsertOnly = (env) => env?._kind !== 'milestone'

  const getEntityLastModified = (env) => env?.updated_at ?? env?.updatedAt ?? 0

  // Every entityId this device currently holds — the HWM=0 full-snapshot seed
  // (Part B) marks all of these dirty so a fresh device uploads its whole state.
  const allEntityIds = async () => [
    ...(await store.milestones.all()).map(m => m.id),
    ...(await store.chapters.all()).map(c => c.id),
    ...BUNDLE_KINDS.map(bundleEntityId),
  ]

  return {
    getLocalEntity,
    applyRemoteEntity,
    applyRemoteDelete,
    isInsertOnly,
    getEntityLastModified,
    allEntityIds,
  }
}
