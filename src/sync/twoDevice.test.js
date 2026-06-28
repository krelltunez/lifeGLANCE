// GLANCEvault sync cutover — STAGE 2 PART A: multi-device MERGE-correctness gate.
//
// Stage 1 proved REPRESENTABILITY (a single device's data round-trips through
// rows). It did NOT prove MERGE CORRECTNESS: when two devices edit between syncs,
// a naive entity-grain LWW silently drops one edit. Stage 1 flagged three such
// hazards. This harness reproduces each with two devices sharing one in-memory
// vault, driving the REAL adapter callbacks (makeDbAdapter) and the REAL
// per-entity crypto, and asserts no edit is lost.
//
// The push/pull loop mirrors @glance-apps/sync dbEngine.js applyRemoteRow exactly
// (decrypt → getLocalEntity → null? apply : insertOnly? apply : LWW), so the
// adapter behaves here precisely as it will under the real engine. The vault
// keeps only the latest row per entityId, so two devices pushing the same bundle
// in one round clobber each other — exercising the re-push-superset convergence.

import { describe, it, expect, beforeAll } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { encryptEntity, decryptEntity, setupDbRootKey } from '@glance-apps/sync'
import { buildMilestone } from '../data/milestones.js'
import { buildChapter, normalizeMemberOps } from '../data/chapters.js'
import { makeDbAdapter, bundleEntityId } from './dbAdapter.js'

// ── In-memory app store (one per device) ────────────────────────────────────
function makeMemStore() {
  const milestones = new Map()
  const chapters = new Map()
  const bundles = {
    categories:          { value: [], updatedAt: '' },
    birthday:            { value: '', updatedAt: '' },
    milestoneTombstones: { value: {} },
    chapterTombstones:   { value: {} },
  }
  return {
    milestones: {
      get: (id) => milestones.get(id) ?? null,
      put: (m) => milestones.set(m.id, m),
      delete: (id) => milestones.delete(id),
      all: () => [...milestones.values()],
    },
    chapters: {
      get: (id) => chapters.get(id) ?? null,
      put: (c) => chapters.set(c.id, c),
      delete: (id) => chapters.delete(id),
      all: () => [...chapters.values()],
    },
    getBundle: (kind) => bundles[kind],
    putBundle: (kind, repr) => { bundles[kind] = repr },
  }
}

// ── In-memory vault (shared by both devices) ────────────────────────────────
function makeMemVault() {
  const rows = new Map() // entityId -> { entityId, envelope, deleted, seq }
  let seq = 0
  return {
    batch(upserts) {
      for (const r of upserts) { seq += 1; rows.set(r.entityId, { entityId: r.entityId, envelope: r.envelope, deleted: false, seq }) }
      return { maxSeq: seq }
    },
    deleteRow(entityId) {
      seq += 1
      const prev = rows.get(entityId)
      rows.set(entityId, { entityId, envelope: prev?.envelope, deleted: true, seq })
      return { seq }
    },
    list(since) {
      const out = [...rows.values()].filter(r => r.seq > since).sort((a, b) => a.seq - b.seq)
      return { rows: out, hasMore: false }
    },
  }
}

// ── Device = store + adapter + dirty set + pull cursor ───────────────────────
function makeDevice(vault) {
  const dev = { store: makeMemStore(), dirty: new Set(), hwm: 0 }
  dev.adapter = makeDbAdapter({ store: dev.store, markDirty: (id) => dev.dirty.add(id) })
  dev.markDirty = (id) => dev.dirty.add(id)
  dev.push = async () => {
    const upserts = []
    for (const id of [...dev.dirty]) {
      const env = await dev.adapter.getLocalEntity(id)
      if (env == null) { vault.deleteRow(id); continue }
      upserts.push({ entityId: id, envelope: await encryptEntity(env, id) })
    }
    if (upserts.length) vault.batch(upserts)
    dev.dirty.clear()
  }
  dev.pull = async () => {
    const { rows } = vault.list(dev.hwm)
    for (const R of rows) {
      if (R.deleted) {
        await dev.adapter.applyRemoteDelete(R.entityId)
        dev.dirty.delete(R.entityId)
      } else {
        const env = await decryptEntity(R.envelope, R.entityId)
        const local = await dev.adapter.getLocalEntity(R.entityId)
        if (local == null) {
          await dev.adapter.applyRemoteEntity(R.entityId, env)
        } else if (dev.adapter.isInsertOnly(env)) {
          await dev.adapter.applyRemoteEntity(R.entityId, env)
        } else if (dev.adapter.getEntityLastModified(env) > dev.adapter.getEntityLastModified(local)) {
          await dev.adapter.applyRemoteEntity(R.entityId, env)
          dev.dirty.delete(R.entityId)
        }
      }
      if (R.seq > dev.hwm) dev.hwm = R.seq
    }
  }
  return dev
}

// Push both, pull both, repeated — lets the re-push-superset settle. Monotone
// joins converge in ≤2 rounds; 6 is ample headroom.
async function fullSync(A, B, rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    await A.push(); await B.push()
    await A.pull(); await B.pull()
  }
}

// Seed identical converged state on both devices WITHOUT marking dirty
// (simulates state already synced before the divergent edits under test).
function seedBoth(A, B, seedFn) {
  for (const dev of [A, B]) seedFn(dev.store)
}

const iso = (ms) => new Date(ms).toISOString()

let vault, A, B
beforeAll(async () => {
  global.indexedDB = new IDBFactory()
  const salt = new Uint8Array(16).fill(9)
  await setupDbRootKey('two-device-harness-passphrase', salt, { cryptoDBName: 'twodevice-test-crypto' })
})

describe('Stage 2 Part A — two-device merge correctness', () => {
  beforeAll(() => { /* fresh devices per test via local setup below */ })

  function fresh() {
    vault = makeMemVault()
    A = makeDevice(vault)
    B = makeDevice(vault)
  }

  // ── A1: CATEGORIES — whole-array LWW hazard (spec 5.3) ────────────────────
  it('A1: concurrent edits to DIFFERENT categories on two devices — neither lost', async () => {
    fresh()
    // Both start synced with the same single category.
    seedBoth(A, B, (s) => s.putBundle('categories', {
      value: [{ id: 'personal', label: 'personal', color: '#9370DB' }],
      updatedAt: iso(1000),
    }))

    // Device A adds category X at t=2000; Device B adds a DIFFERENT category Y at
    // t=3000 — both between syncs.
    A.store.putBundle('categories', {
      value: [{ id: 'personal', label: 'personal', color: '#9370DB' }, { id: 'X', label: 'Side Project', color: '#FF8800' }],
      updatedAt: iso(2000),
    })
    A.markDirty(bundleEntityId('categories'))
    B.store.putBundle('categories', {
      value: [{ id: 'personal', label: 'personal', color: '#9370DB' }, { id: 'Y', label: 'Garden', color: '#5CAD6E' }],
      updatedAt: iso(3000),
    })
    B.markDirty(bundleEntityId('categories'))

    await fullSync(A, B)

    for (const dev of [A, B]) {
      const ids = dev.store.getBundle('categories').value.map(c => c.id).sort()
      expect(ids).toEqual(['X', 'Y', 'personal']) // both edits survived on both devices
    }
    // Converged byte-identical.
    expect(A.store.getBundle('categories')).toEqual(B.store.getBundle('categories'))
  })

  it('A1b: same category id edited on both — deterministic LWW by bundle timestamp, no different-id loss', async () => {
    fresh()
    seedBoth(A, B, (s) => s.putBundle('categories', {
      value: [{ id: 'career', label: 'career', color: '#4A90D9' }],
      updatedAt: iso(1000),
    }))
    // A renames 'career' (older); B recolors the SAME 'career' (newer) AND adds 'Z'.
    A.store.putBundle('categories', { value: [{ id: 'career', label: 'Work', color: '#4A90D9' }], updatedAt: iso(2000) })
    A.markDirty(bundleEntityId('categories'))
    B.store.putBundle('categories', {
      value: [{ id: 'career', label: 'career', color: '#000000' }, { id: 'Z', label: 'Music', color: '#E85D75' }],
      updatedAt: iso(4000),
    })
    B.markDirty(bundleEntityId('categories'))

    await fullSync(A, B)

    for (const dev of [A, B]) {
      const cats = dev.store.getBundle('categories').value
      const career = cats.find(c => c.id === 'career')
      expect(career.color).toBe('#000000') // newer (B) wins the same-id conflict
      expect(cats.some(c => c.id === 'Z')).toBe(true) // A's loss avoided — Z (a different id) kept
    }
    expect(A.store.getBundle('categories')).toEqual(B.store.getBundle('categories'))
  })

  // ── A2: CHAPTER.milestoneIds — within-entity membership-set hazard ────────
  it('A2: concurrent adds of DIFFERENT milestones to the SAME chapter — both kept', async () => {
    fresh()
    const chapter = buildChapter({ title: 'University', start: new Date('2010-01-01'), color: '#4A90D9' })
    chapter.created_at = iso(1000); chapter.updated_at = iso(1000)
    seedBoth(A, B, (s) => s.chapters.put({ ...chapter, memberOps: {} }))

    const mA = buildMilestone({ title: 'A', date: new Date('2011-01-01') })
    const mB = buildMilestone({ title: 'B', date: new Date('2012-01-01') })

    // Device A adds milestone A to chapter C; Device B adds milestone B to the
    // SAME chapter C — both between syncs (the lifeGLANCE-specific hazard).
    const cA = A.store.chapters.get(chapter.id)
    A.store.chapters.put({ ...cA, milestoneIds: [mA.id], memberOps: { ...normalizeMemberOps(cA), [mA.id]: { op: 'add', at: iso(2000) } }, updated_at: iso(2000) })
    A.markDirty(chapter.id)
    const cB = B.store.chapters.get(chapter.id)
    B.store.chapters.put({ ...cB, milestoneIds: [mB.id], memberOps: { ...normalizeMemberOps(cB), [mB.id]: { op: 'add', at: iso(3000) } }, updated_at: iso(3000) })
    B.markDirty(chapter.id)

    await fullSync(A, B)

    for (const dev of [A, B]) {
      const c = dev.store.chapters.get(chapter.id)
      expect([...c.milestoneIds].sort()).toEqual([mA.id, mB.id].sort()) // BOTH memberships present
    }
    expect(A.store.chapters.get(chapter.id)).toEqual(B.store.chapters.get(chapter.id))
  })

  it('A2b: concurrent add(one device) + remove(other device) of the SAME member — latest op wins, no resurrection/drop', async () => {
    fresh()
    const chapter = buildChapter({ title: 'Travels', start: new Date('2015-01-01'), color: '#C8A96E' })
    chapter.created_at = iso(1000); chapter.updated_at = iso(1000)
    const mX = buildMilestone({ title: 'X', date: new Date('2016-01-01') })
    // Seed both with X already a member (added at t=1000).
    seedBoth(A, B, (s) => s.chapters.put({ ...chapter, milestoneIds: [mX.id], memberOps: { [mX.id]: { op: 'add', at: iso(1000) } } }))

    // Device A REMOVES X at t=5000 (latest). Device B re-adds/keeps X via an
    // earlier add at t=2000 and adds a sibling.
    const cA = A.store.chapters.get(chapter.id)
    A.store.chapters.put({ ...cA, milestoneIds: [], memberOps: { ...normalizeMemberOps(cA), [mX.id]: { op: 'remove', at: iso(5000) } }, updated_at: iso(5000) })
    A.markDirty(chapter.id)
    const cB = B.store.chapters.get(chapter.id)
    B.store.chapters.put({ ...cB, milestoneIds: [mX.id], memberOps: { ...normalizeMemberOps(cB), [mX.id]: { op: 'add', at: iso(2000) } }, updated_at: iso(2000) })
    B.markDirty(chapter.id)

    await fullSync(A, B)

    for (const dev of [A, B]) {
      const c = dev.store.chapters.get(chapter.id)
      expect(c.milestoneIds).not.toContain(mX.id) // remove@5000 beats add@2000 — not resurrected
    }
    expect(A.store.chapters.get(chapter.id)).toEqual(B.store.chapters.get(chapter.id))
  })

  it('A2c: removal is not undone by the peer’s stale member list (set-union-alone bug)', async () => {
    fresh()
    const chapter = buildChapter({ title: 'Career', start: new Date('2018-01-01'), color: '#4A90D9' })
    chapter.created_at = iso(1000); chapter.updated_at = iso(1000)
    const mX = buildMilestone({ title: 'X', date: new Date('2019-01-01') })
    seedBoth(A, B, (s) => s.chapters.put({ ...chapter, milestoneIds: [mX.id], memberOps: { [mX.id]: { op: 'add', at: iso(1000) } } }))

    // Device A removes X (t=4000). Device B never touches membership — it still
    // holds the stale [X] list. A plain set-union would resurrect X.
    const cA = A.store.chapters.get(chapter.id)
    A.store.chapters.put({ ...cA, milestoneIds: [], memberOps: { ...normalizeMemberOps(cA), [mX.id]: { op: 'remove', at: iso(4000) } }, updated_at: iso(4000) })
    A.markDirty(chapter.id)
    // B makes an unrelated scalar edit so its chapter row is also pushed.
    const cB = B.store.chapters.get(chapter.id)
    B.store.chapters.put({ ...cB, description: 'edited on B', updated_at: iso(2000) })
    B.markDirty(chapter.id)

    await fullSync(A, B)

    for (const dev of [A, B]) {
      expect(dev.store.chapters.get(chapter.id).milestoneIds).toEqual([]) // X stays removed
    }
    expect(A.store.chapters.get(chapter.id)).toEqual(B.store.chapters.get(chapter.id))
  })

  // ── A3: TOMBSTONE MAPS — must NOT regress to whole-map LWW ─────────────────
  it('A3: each device tombstones a DIFFERENT entity — both tombstones survive (per-key merge preserved)', async () => {
    fresh()
    seedBoth(A, B, (s) => s.putBundle('milestoneTombstones', { value: {} }))

    A.store.putBundle('milestoneTombstones', { value: { 'dead-on-A': iso(2000) } })
    A.markDirty(bundleEntityId('milestoneTombstones'))
    B.store.putBundle('milestoneTombstones', { value: { 'dead-on-B': iso(3000) } })
    B.markDirty(bundleEntityId('milestoneTombstones'))

    await fullSync(A, B)

    for (const dev of [A, B]) {
      const tomb = dev.store.getBundle('milestoneTombstones').value
      expect(Object.keys(tomb).sort()).toEqual(['dead-on-A', 'dead-on-B']) // neither lost
    }
    expect(A.store.getBundle('milestoneTombstones')).toEqual(B.store.getBundle('milestoneTombstones'))
  })

  // ── birthday — single scalar, LWW is correct (no concurrent-different-entry) ─
  it('birthday: LWW by paired timestamp converges to the newer value', async () => {
    fresh()
    seedBoth(A, B, (s) => s.putBundle('birthday', { value: '1990-01-01', updatedAt: iso(1000) }))
    A.store.putBundle('birthday', { value: '1990-05-20', updatedAt: iso(2000) })
    A.markDirty(bundleEntityId('birthday'))
    B.store.putBundle('birthday', { value: '1991-12-31', updatedAt: iso(5000) }) // newer
    B.markDirty(bundleEntityId('birthday'))

    await fullSync(A, B)

    for (const dev of [A, B]) expect(dev.store.getBundle('birthday').value).toBe('1991-12-31')
    expect(A.store.getBundle('birthday')).toEqual(B.store.getBundle('birthday'))
  })

  // ── Regression: a plain milestone field edit still LWWs (sanity) ───────────
  it('milestone: newer field edit wins under entity-grain LWW', async () => {
    fresh()
    const m = buildMilestone({ title: 'Trip', date: new Date('2020-01-01') })
    m.created_at = iso(1000); m.updated_at = iso(1000)
    seedBoth(A, B, (s) => s.milestones.put({ ...m }))
    A.store.milestones.put({ ...A.store.milestones.get(m.id), note: 'from A', updated_at: iso(2000) })
    A.markDirty(m.id)
    B.store.milestones.put({ ...B.store.milestones.get(m.id), note: 'from B', updated_at: iso(5000) })
    B.markDirty(m.id)

    await fullSync(A, B)

    for (const dev of [A, B]) expect(dev.store.milestones.get(m.id).note).toBe('from B')
    expect(A.store.milestones.get(m.id)).toEqual(B.store.milestones.get(m.id))
  })
})
