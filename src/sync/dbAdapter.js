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
//   life                → row, entityId = life.id      (per-item, plain LWW; Lives v5.0)
//   lifeTombstones      → one bundle row            (MERGE-on-apply)
//
// Milestones are MERGE-on-apply too since Lives v5.0: their `lifeOps` is a
// membership set (which Lives the milestone belongs to), merged per Life like
// chapter memberOps, while every other field stays entity-grain LWW.
//
// Discrimination (Stage 1, spec 5.2): every envelope carries an explicit `_kind`
// and a `life_id`. `life_id` never identified a Life: since Lives Phase 1 it
// carries this device's writer stamp (writerStamp.js explains why it has to be
// that field). entityIds for milestones/chapters are their
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
import { tombstoneCutoff, pruneTombstoneMap } from './tombstoneRetention.js'
import { rowStamp, readRowStamp, noteWriter } from './writerStamp.js'
import { recordWriter, LEGACY_VAULT } from './lifeGate.js'
import { normalizeLifeOps } from '../data/lifeMembership.js'
import { ME_LIFE_ID } from '../data/db.js'

export { LIFE_ID, BUNDLE_KINDS, bundleEntityId }

const TOMBSTONE_KINDS = new Set(['milestoneTombstones', 'chapterTombstones', 'lifeTombstones'])
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
// id → ISO. UNION keeping the latest ISO per key (commutative), then PRUNED at
// the shared fixed retention cutoff (#287). Pruning inside the merge — rather
// than as a separate local pass — is what escapes the grow-only re-inflation
// trap: a peer's unpruned copy contributes only entries inside the window, so
// a pruned map can never oscillate pruned↔restored across cycles. The cutoff
// is day-floored (tombstoneRetention.js), so every merge within a UTC day
// computes the same result and an unchanged bundle compares equal (no dirty
// mark, no push, no SSE self-nudge).
export function mergeTombstoneMap(localMap, remoteMap, cutoff = tombstoneCutoff()) {
  const out = { ...(localMap && typeof localMap === 'object' ? localMap : {}) }
  const r = remoteMap && typeof remoteMap === 'object' ? remoteMap : {}
  for (const [id, iso] of Object.entries(r)) {
    if (!(id in out) || ts(iso) > ts(out[id])) out[id] = iso
  }
  return pruneTombstoneMap(out, cutoff)
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

// Merge two milestone versions (Lives v5.0). Every field but lifeOps is
// entity-grain LWW by updated_at: the newer side wins, and an exact tie goes to
// the side with the smaller serialization, so both devices pick the same one.
// lifeOps (which Lives the milestone belongs to) merges per Life by the same
// rule as chapter membership, so adding Mom on one device and Dad on another
// keeps both. A side with no lifeOps belongs to Me only (normalizeLifeOps); the
// merged record carries lifeOps only if either side had it, so pre-Lives
// records are left exactly as they were.
export function mergeMilestones(local, remote) {
  const lt = ts(local.updated_at), rt = ts(remote.updated_at)
  const remoteWins = rt > lt || (rt === lt && JSON.stringify(canonical(remote)) < JSON.stringify(canonical(local)))
  const merged = { ...(remoteWins ? remote : local) }
  if (local.lifeOps || remote.lifeOps) {
    merged.lifeOps = mergeMemberOps(normalizeLifeOps(local), normalizeLifeOps(remote))
  }
  return merged
}

// The app's list of Lives lives in React state; tell it a sync changed one.
const announceLivesChanged = () => {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('lifeglance:lives-changed'))
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

// isLivePull() says whether rows pulled now are new writes (this device has
// finished its first full pull), as opposed to the account's history arriving
// on a new device. Only new writes count towards the Lives gate (lifeGate.js).
const NO_LIVES = { get: () => null, put: () => {}, delete: () => {}, all: () => [] }

export function makeDbAdapter({ store, markDirty = () => {}, deviceId = null, isLivePull = () => false }) {
  const lives = store.lives ?? NO_LIVES
  const deepEqual = sameContent
  // Built per row so the stamp always reports this build; cheap.
  const stamp = () => rowStamp(deviceId)

  // Store ops may be async (real db.js / localStorage) or sync (the in-memory
  // harness); awaiting works for both. Callbacks the engine awaits are async.

  // ── Bundle envelope <-> repr ──
  const bundleEnvelope = async (kind) => {
    const repr = await store.getBundle(kind)
    // Tombstone bundles are pruned at PRODUCE too (#287): the pushed envelope
    // must carry the same pruned set the merge side computes, or a device
    // holding a stale unpruned local copy would keep re-publishing aged-out
    // entries for its peers to re-merge. Same day-floored cutoff as the merge,
    // so produce and merge agree byte-for-byte within a day.
    const value = TOMBSTONE_KINDS.has(kind)
      ? pruneTombstoneMap(repr.value, tombstoneCutoff())
      : repr.value
    const env = { _kind: kind, life_id: stamp(), value }
    if ('updatedAt' in repr) env.updatedAt = repr.updatedAt
    return env
  }
  const applyBundle = async (kind, env) => {
    const local = await store.getBundle(kind)
    let mergedRepr
    if (kind === 'categories') {
      const m = mergeCategories(local.value, local.updatedAt, env.value, env.updatedAt)
      mergedRepr = { value: m.categories, updatedAt: m.categoriesUpdatedAt }
    } else if (TOMBSTONE_KINDS.has(kind)) {
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
    // The stored record goes first so a stale `_kind` / `life_id` that an older
    // build may have stored can never override this device's own.
    const m = await store.milestones.get(entityId)
    if (m) return { ...m, _kind: 'milestone', life_id: stamp() }
    const c = await store.chapters.get(entityId)
    if (c) return { ...c, _kind: 'chapter', life_id: stamp() }
    const l = await lives.get(entityId)
    if (l) return { ...l, _kind: 'life', life_id: stamp() }
    return null
  }

  const applyRemoteEntity = async (entityId, env) => {
    const kind = env?._kind
    // A row from a newer build tells the UI to suggest updating this device.
    const rowWriter = readRowStamp(env?.life_id)
    noteWriter(rowWriter)
    // Who wrote it, for the Lives gate. Only new writes count: the account's
    // history, pulled on a new device's first sync, says nothing about which
    // devices are still active.
    if (isLivePull()) {
      if (rowWriter) recordWriter(rowWriter.device ?? 'unknown', rowWriter)
      else recordWriter(LEGACY_VAULT, { schema: 0 })
    }
    if (kind === 'milestone') {
      const remote = stripEnvelope(env)
      const local = await store.milestones.get(entityId)
      if (!local) { await store.milestones.put(remote); return }
      const merged = mergeMilestones(local, remote)
      if (!deepEqual(merged, local)) await store.milestones.put(merged)
      // Richer than what the peer pushed → re-push the merged record.
      if (!deepEqual(merged, remote)) markDirty(entityId)
      return
    }
    if (kind === 'life') {
      // Plain LWW, already resolved by the engine: remote won (or local absent).
      await lives.put(stripEnvelope(env))
      announceLivesChanged()
      return
    }
    if (kind === 'chapter') {
      const remoteChapter = stripEnvelope(env)
      const local = await store.chapters.get(entityId)
      if (!local) { await store.chapters.put({ ...remoteChapter, memberOps: normalizeMemberOps(remoteChapter) }); return }
      const merged = mergeChapters(local, remoteChapter)
      await store.chapters.put(merged)
      // Richer-than-remote → re-push the merged superset. Compared without the
      // envelope: the peer's writer stamp is not chapter content, and counting
      // it would re-push every chapter on every pull.
      if (!deepEqual(merged, stripEnvelope(env))) markDirty(entityId)
      return
    }
    if (BUNDLE_ID_TO_KIND[entityId]) { await applyBundle(BUNDLE_ID_TO_KIND[entityId], env); return }
    if (BUNDLE_KINDS.includes(kind)) { await applyBundle(kind, env); return }
    // A row kind this build does not know: written by a newer build (Lives
    // records, relationship edges). Leave it alone. The vault keeps it for the
    // devices that understand it, and this device never pushes it, so nothing
    // is lost. Throwing would quarantine it and report "skipped rows" on every
    // cycle, which is noise, not a problem the user can fix.
    if (import.meta?.env?.DEV) console.info(`[dbsync] ignoring row of unknown kind ${kind} (${entityId})`)
  }

  const applyRemoteDelete = async (entityId) => {
    // Bundles are never deleted. A bare-UUID delete is a milestone or a chapter;
    // delete from both stores (the wrong one is a harmless no-op).
    if (isBundleEntityId(entityId)) return
    await store.milestones.delete(entityId)
    await store.chapters.delete(entityId)
    // The Me Life is never deleted, whatever a peer pushes.
    if (entityId !== ME_LIFE_ID && await lives.get(entityId)) {
      await lives.delete(entityId)
      announceLivesChanged()
    }
  }

  // Milestones, chapters and bundles are merge-on-apply: report insert-only so
  // the engine always routes them to applyRemoteEntity instead of doing its own
  // LWW. Life records are flat, so they keep the engine's LWW.
  const isInsertOnly = (env) => env?._kind !== 'life'

  const getEntityLastModified = (env) => env?.updated_at ?? env?.updatedAt ?? 0

  // Every entityId this device currently holds — the HWM=0 full-snapshot seed
  // (Part B) marks all of these dirty so a fresh device uploads its whole state.
  const allEntityIds = async () => [
    ...(await store.milestones.all()).map(m => m.id),
    ...(await store.chapters.all()).map(c => c.id),
    ...(await lives.all()).map(l => l.id),
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
