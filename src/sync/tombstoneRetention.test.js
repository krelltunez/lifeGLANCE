// Tests for the shared fixed tombstone-retention policy (#287) — the window,
// the day-floored cutoff's stability, the fail-safe prune, and the
// anti-oscillation properties the vault tier's merge/produce sides hang on.

import { describe, it, expect } from 'vitest'
import {
  TOMBSTONE_RETENTION_DAYS, floorToUtcDayIso, tombstoneCutoff, pruneTombstoneMap,
} from './tombstoneRetention.js'
import { mergeTombstoneMap, makeDbAdapter, bundleEntityId } from './dbAdapter.js'

const DAY_MS = 24 * 60 * 60 * 1000
const iso = (ms) => new Date(ms).toISOString()

describe('floorToUtcDayIso', () => {
  it('floors to the start of the UTC day and is idempotent', () => {
    const floored = floorToUtcDayIso('2026-08-09T17:23:45.678Z')
    expect(floored).toBe('2026-08-09T00:00:00.000Z')
    expect(floorToUtcDayIso(floored)).toBe(floored)
  })
  it('passes null/undefined/garbage through unchanged', () => {
    expect(floorToUtcDayIso(null)).toBeNull()
    expect(floorToUtcDayIso(undefined)).toBeUndefined()
    expect(floorToUtcDayIso('not-a-date')).toBe('not-a-date')
  })
})

describe('tombstoneCutoff', () => {
  it('is stable across every moment of a UTC day (the anti-churn property)', () => {
    const morning = Date.UTC(2026, 7, 9, 0, 30)
    const night = Date.UTC(2026, 7, 9, 23, 59)
    expect(tombstoneCutoff(morning).getTime()).toBe(tombstoneCutoff(night).getTime())
  })
  it('advances exactly one day at the UTC rollover', () => {
    const before = tombstoneCutoff(Date.UTC(2026, 7, 9, 23, 59))
    const after = tombstoneCutoff(Date.UTC(2026, 7, 10, 0, 1))
    expect(after.getTime() - before.getTime()).toBe(DAY_MS)
  })
})

describe('pruneTombstoneMap', () => {
  const now = Date.now()
  const cutoff = tombstoneCutoff(now)
  it('drops entries older than the cutoff, keeps newer ones', () => {
    const old = iso(now - (TOMBSTONE_RETENTION_DAYS + 5) * DAY_MS)
    const fresh = iso(now - 1000)
    expect(pruneTombstoneMap({ a: old, b: fresh }, cutoff)).toEqual({ b: fresh })
  })
  it('keeps unparseable timestamps (fail-safe: never lose an undatable tombstone)', () => {
    expect(pruneTombstoneMap({ a: 'garbage', b: iso(now) }, cutoff)).toEqual({ a: 'garbage', b: iso(now) })
  })
  it('null cutoff returns an unpruned copy; input is never mutated', () => {
    const src = { a: iso(0) }
    const out = pruneTombstoneMap(src, null)
    expect(out).toEqual(src)
    expect(out).not.toBe(src)
  })
})

describe('vault tier merge + produce pruning (#287 anti-oscillation)', () => {
  const now = Date.now()
  const OLD = iso(now - (TOMBSTONE_RETENTION_DAYS + 10) * DAY_MS)
  const FRESH = iso(now - 60_000)

  it("a peer's unpruned copy cannot re-inflate a pruned map through the merge", () => {
    const localPruned = { keep: FRESH }
    const remoteUnpruned = { keep: FRESH, ancient: OLD }
    expect(mergeTombstoneMap(localPruned, remoteUnpruned)).toEqual({ keep: FRESH })
  })

  it('two merges of the same inputs within a day are identical (no churn source)', () => {
    const a = mergeTombstoneMap({ x: FRESH }, { y: FRESH, ancient: OLD })
    const b = mergeTombstoneMap({ x: FRESH }, { y: FRESH, ancient: OLD })
    expect(a).toEqual(b)
  })

  function makeStore(tombstones) {
    const bundles = {
      categories: { value: [], updatedAt: '' },
      birthday: { value: '', updatedAt: '' },
      milestoneTombstones: { value: tombstones },
      chapterTombstones: { value: {} },
    }
    return {
      milestones: { get: () => null, put: () => {}, delete: () => {}, all: () => [] },
      chapters: { get: () => null, put: () => {}, delete: () => {}, all: () => [] },
      getBundle: (kind) => bundles[kind],
      putBundle: (kind, repr) => { bundles[kind] = repr },
      _bundles: bundles,
    }
  }

  it('produce: the pushed envelope is pruned even when the stored copy is stale', async () => {
    const store = makeStore({ keep: FRESH, ancient: OLD })
    const adapter = makeDbAdapter({ store, markDirty: () => {} })
    const env = await adapter.getLocalEntity(bundleEntityId('milestoneTombstones'))
    expect(env.value).toEqual({ keep: FRESH })
  })

  it('converges instead of looping: unpruned remote → ONE superset re-push, then silence', async () => {
    const dirtied = []
    const store = makeStore({ keep: FRESH })
    const adapter = makeDbAdapter({ store, markDirty: (id) => dirtied.push(id) })
    const tombId = bundleEntityId('milestoneTombstones')

    // Cycle 1: a peer still carries an aged-out entry. The merge prunes it;
    // merged != remote's raw value, so the superset re-push is marked ONCE.
    await adapter.applyRemoteEntity(tombId, { _kind: 'milestoneTombstones', life_id: 'default', value: { keep: FRESH, ancient: OLD } })
    expect(store._bundles.milestoneTombstones.value).toEqual({ keep: FRESH })
    expect(dirtied).toEqual([tombId])

    // Cycle 2: the re-push landed; the peer now carries the pruned value. The
    // merge is byte-identical — no dirty mark, no push, no SSE self-nudge.
    await adapter.applyRemoteEntity(tombId, { _kind: 'milestoneTombstones', life_id: 'default', value: { keep: FRESH } })
    expect(store._bundles.milestoneTombstones.value).toEqual({ keep: FRESH })
    expect(dirtied).toEqual([tombId]) // unchanged: exactly one, from cycle 1
  })
})

describe('both tiers agree on undatable entries (audit note)', () => {
  it('file-tier mergePayloads keeps a garbage-timestamp tombstone, like the vault tier', async () => {
    const { mergePayloads } = await import('./adapter.js')
    const fresh = new Date().toISOString()
    const local = { lives: { default: { milestones: [], chapters: [], milestoneTombstones: { ok: fresh, corrupt: 'not-a-date' }, chapterTombstones: {} } } }
    const remote = { lives: { default: { milestones: [], chapters: [], milestoneTombstones: {}, chapterTombstones: {} } } }
    const { data } = mergePayloads(local, remote)
    expect(data.lives.default.milestoneTombstones).toEqual({ ok: fresh, corrupt: 'not-a-date' })
  })
})
