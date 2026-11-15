import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}))

// Lives Phase 2b: Lives on both sync tiers, schema 2, and the 60-day gate.
// Source of truth: docs/lifeGLANCE-app-spec.md ("Where ownership lives on the
// wire", "Sync and version skew").

const memStorage = () => {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    clear: () => m.clear(),
  }
}

beforeEach(() => {
  globalThis.localStorage = memStorage()
  global.indexedDB = new IDBFactory()
  vi.resetModules()
})

const DAY = 24 * 60 * 60 * 1000
const at = (iso) => iso
const T1 = '2026-11-01T10:00:00.000Z'
const T2 = '2026-11-02T10:00:00.000Z'
const T3 = '2026-11-03T10:00:00.000Z'

// ── A vault harness that drives the adapter the way the engine does ─────────
// Push: each dirty id → getLocalEntity → row (or a soft delete if gone).
// Pull: rows above the cursor → absent locally or insert-only → apply;
// otherwise LWW on getEntityLastModified. The vault keeps the latest row per id.

function memStore() {
  const coll = () => {
    const m = new Map()
    return { m, get: (id) => m.get(id) ?? null, put: (x) => m.set(x.id, structuredClone(x)), delete: (id) => m.delete(id), all: () => [...m.values()] }
  }
  const bundles = {
    categories: { value: [], updatedAt: '' }, birthday: { value: '', updatedAt: '' },
    milestoneTombstones: { value: {} }, chapterTombstones: { value: {} }, lifeTombstones: { value: {} },
    relationshipTombstones: { value: {} },
  }
  return {
    milestones: coll(), chapters: coll(), lives: coll(), relationships: coll(),
    getBundle: (k) => bundles[k], putBundle: (k, r) => { bundles[k] = r },
  }
}

function vault() {
  const rows = new Map()
  let seq = 0
  return {
    rows,
    upsert: (id, env) => rows.set(id, { env: structuredClone(env), deleted: false, seq: ++seq }),
    remove: (id) => rows.set(id, { env: null, deleted: true, seq: ++seq }),
    since: (hwm) => [...rows.entries()].filter(([, r]) => r.seq > hwm).sort((a, b) => a[1].seq - b[1].seq),
    seq: () => seq,
  }
}

async function device(v, name, { live = true } = {}) {
  const { makeDbAdapter } = await import('./dbAdapter.js')
  const store = memStore()
  const dirty = new Set()
  let hwm = 0
  const adapter = makeDbAdapter({ store, deviceId: name, markDirty: (id) => dirty.add(id), isLivePull: () => live })
  return {
    vault: v, store, dirty, adapter,
    async push() {
      for (const id of [...dirty]) {
        dirty.delete(id)
        const env = await adapter.getLocalEntity(id)
        if (env) v.upsert(id, env); else v.remove(id)
      }
    },
    async pull() {
      for (const [id, row] of v.since(hwm)) {
        hwm = Math.max(hwm, row.seq)
        if (row.deleted) { await adapter.applyRemoteDelete(id); continue }
        const local = await adapter.getLocalEntity(id)
        if (!local || adapter.isInsertOnly(row.env)) { await adapter.applyRemoteEntity(id, row.env); continue }
        const lt = Date.parse(adapter.getEntityLastModified(local) || 0)
        const rt = Date.parse(adapter.getEntityLastModified(row.env) || 0)
        if (rt > lt) await adapter.applyRemoteEntity(id, row.env)
      }
    },
  }
}

// Settled = a whole round in which no device pushed anything new and nothing is
// left dirty. Returns how many rounds that took.
async function converge(devices, rounds = 6) {
  const v = devices[0].vault
  for (let i = 0; i < rounds; i++) {
    const before = v.seq()
    for (const d of devices) { await d.push(); await d.pull() }
    if (v.seq() === before && devices.every(d => d.dirty.size === 0)) return i
  }
  throw new Error('did not converge')
}

const milestone = (id, extra = {}) => ({ id, title: id, date: '2015-06-01T00:00:00.000Z', category: 'family', created_at: T1, updated_at: T1, ...extra })

describe('Life records on the vault', () => {
  it('a Life added on one device reaches the other, and a later edit wins', async () => {
    const v = vault()
    const a = await device(v, 'A'), b = await device(v, 'B')
    a.store.lives.put({ id: 'L1', name: 'Mom', updated_at: T1 }); a.dirty.add('L1')
    await converge([a, b])
    expect(b.store.lives.get('L1')).toEqual({ id: 'L1', name: 'Mom', updated_at: T1 })
    b.store.lives.put({ id: 'L1', name: 'Mother', updated_at: T2 }); b.dirty.add('L1')
    await converge([a, b])
    expect(a.store.lives.get('L1').name).toBe('Mother')
  })

  it('concurrent edits settle on the newer one, even when the older is pushed last', async () => {
    // The engine pushes before it pulls: B's older edit lands on top of A's
    // newer row. A must see that and push its own again.
    const v = vault()
    const a = await device(v, 'A'), b = await device(v, 'B')
    a.store.lives.put({ id: 'L1', name: 'Mom', updated_at: T1 }); a.dirty.add('L1')
    await converge([a, b])
    a.store.lives.put({ id: 'L1', name: 'Mother', updated_at: T3 }); a.dirty.add('L1')
    b.store.lives.put({ id: 'L1', name: 'Mum', updated_at: T2 }); b.dirty.add('L1')
    await converge([a, b])
    for (const d of [a, b]) expect(d.store.lives.get('L1').name).toBe('Mother')
    expect(v.rows.get('L1').env.name).toBe('Mother')
  })

  it('a tie on updated_at settles on the same record everywhere', async () => {
    const v = vault()
    const a = await device(v, 'A'), b = await device(v, 'B')
    a.store.lives.put({ id: 'L1', name: 'Mom', updated_at: T2 }); a.dirty.add('L1')
    b.store.lives.put({ id: 'L1', name: 'Mum', updated_at: T2 }); b.dirty.add('L1')
    await converge([a, b])
    expect(a.store.lives.get('L1')).toEqual(b.store.lives.get('L1'))
  })

  it('a deleted Life is deleted on the other device, but a delete of Me is never applied', async () => {
    const v = vault()
    const a = await device(v, 'A'), b = await device(v, 'B')
    for (const d of [a, b]) d.store.lives.put({ id: 'me', name: 'Me', updated_at: '1970-01-01T00:00:00.000Z' })
    a.store.lives.put({ id: 'L1', name: 'Mom', updated_at: T1 }); a.dirty.add('L1')
    await converge([a, b])
    a.store.lives.delete('L1'); a.dirty.add('L1')
    v.remove('me')   // a peer pushing a delete of Me, however it came about
    await converge([a, b])
    expect(b.store.lives.get('L1')).toBeNull()
    expect(b.store.lives.get('me')).not.toBeNull()
  })

  it('life tombstones merge as a bundle', async () => {
    const v = vault()
    const a = await device(v, 'A'), b = await device(v, 'B')
    a.store.putBundle('lifeTombstones', { value: { L1: T2 } }); a.dirty.add('life:default:lifeTombstones')
    b.store.putBundle('lifeTombstones', { value: { L2: T2 } }); b.dirty.add('life:default:lifeTombstones')
    await converge([a, b])
    expect(a.store.getBundle('lifeTombstones').value).toEqual({ L1: T2, L2: T2 })
    expect(b.store.getBundle('lifeTombstones').value).toEqual({ L1: T2, L2: T2 })
  })
})

describe('milestone membership on the vault', () => {
  const ops = (o) => Object.fromEntries(Object.entries(o).map(([id, [op, t]]) => [id, { op, at: at(t) }]))

  it('Mom added on one device and Dad on the other: both kept, and it settles', async () => {
    const v = vault()
    const a = await device(v, 'A'), b = await device(v, 'B')
    a.store.milestones.put(milestone('w')); a.dirty.add('w')
    await converge([a, b])
    a.store.milestones.put(milestone('w', { updated_at: T2, lifeOps: ops({ me: ['add', T1], mom: ['add', T2] }) })); a.dirty.add('w')
    b.store.milestones.put(milestone('w', { updated_at: T3, lifeOps: ops({ me: ['add', T1], dad: ['add', T3] }) })); b.dirty.add('w')
    const rounds = await converge([a, b])
    const { lifeIdsOf } = await import('../data/lifeMembership.js')
    expect(lifeIdsOf(a.store.milestones.get('w'))).toEqual(['dad', 'me', 'mom'])
    expect(a.store.milestones.get('w')).toEqual(b.store.milestones.get('w'))
    expect(rounds).toBeLessThan(4)
  })

  it('a title edited on one device and a Life added on the other: both kept', async () => {
    const v = vault()
    const a = await device(v, 'A'), b = await device(v, 'B')
    a.store.milestones.put(milestone('w')); a.dirty.add('w')
    await converge([a, b])
    a.store.milestones.put(milestone('w', { title: 'Our wedding', updated_at: T3 })); a.dirty.add('w')
    b.store.milestones.put(milestone('w', { updated_at: T2, lifeOps: ops({ me: ['add', T1], mom: ['add', T2] }) })); b.dirty.add('w')
    await converge([a, b])
    for (const d of [a, b]) {
      const m = d.store.milestones.get('w')
      expect(m.title).toBe('Our wedding')
      expect(Object.keys(m.lifeOps).sort()).toEqual(['me', 'mom'])
    }
  })

  it('a pre-Lives milestone stays exactly as it was: no lifeOps added, no re-push', async () => {
    const v = vault()
    const a = await device(v, 'A'), b = await device(v, 'B')
    a.store.milestones.put(milestone('m')); a.dirty.add('m')
    b.store.milestones.put(milestone('m')); b.dirty.add('m')
    await converge([a, b])
    expect(a.store.milestones.get('m')).toEqual(milestone('m'))
    expect(b.dirty.size + a.dirty.size).toBe(0)
  })
})

// ── The gate, vault side ────────────────────────────────────────────────────

describe('the Lives gate on the vault', () => {
  const row = (life_id) => ({ _kind: 'milestone', life_id, ...milestone('x') })

  it('ignores rows pulled before this device caught up with the account history', async () => {
    const { makeDbAdapter } = await import('./dbAdapter.js')
    const gate = await import('./lifeGate.js')
    const a = makeDbAdapter({ store: memStore(), deviceId: 'me-device', isLivePull: () => false })
    await a.applyRemoteEntity('x', row('default'))
    expect(gate.blockingWriters()).toEqual([])
  })

  it('counts an unstamped new row as a device older than Phase 1, and a schema 1 row as a Phase 1 device', async () => {
    const { makeDbAdapter } = await import('./dbAdapter.js')
    const gate = await import('./lifeGate.js')
    const a = makeDbAdapter({ store: memStore(), deviceId: 'me-device', isLivePull: () => true })
    await a.applyRemoteEntity('x', row('default'))
    await a.applyRemoteEntity('y', { ...row({ set: 'default', schema: 1, device: 'old-phone', app: '4.1.0', platform: 'android' }), id: 'y' })
    await a.applyRemoteEntity('z', { ...row({ set: 'default', schema: 2, device: 'new-mac', app: '5.0.0', platform: 'web' }), id: 'z' })
    const keys = gate.blockingWriters().map(w => w.key).sort()
    expect(keys).toEqual(['legacy:vault', 'old-phone'])
    expect(gate.canUseMultipleLives()).toBe(false)
  })

  it('never blocks on this device, and stops blocking 60 days after a device was last seen', async () => {
    const gate = await import('./lifeGate.js')
    const { ensureDeviceId } = await import('./deviceId.js')
    gate.recordWriter(ensureDeviceId(), { schema: 1 })
    expect(gate.canUseMultipleLives()).toBe(true)
    const seen = Date.now() - 61 * DAY
    gate.recordWriter('old-phone', { schema: 1 }, seen)
    expect(gate.canUseMultipleLives()).toBe(true)
    gate.recordWriter('old-phone', { schema: 1 }, Date.now() - 59 * DAY)
    expect(gate.canUseMultipleLives()).toBe(false)
  })

  it('a later sighting of a device at schema 2 clears it', async () => {
    const gate = await import('./lifeGate.js')
    gate.recordWriter('phone', { schema: 1 }, Date.now() - DAY)
    expect(gate.canUseMultipleLives()).toBe(false)
    gate.recordWriter('phone', { schema: 2 }, Date.now())
    expect(gate.canUseMultipleLives()).toBe(true)
  })
})

// ── File tier ───────────────────────────────────────────────────────────────

const emptyLife = (extra = {}) => ({ milestones: [], chapters: [], milestoneTombstones: {}, chapterTombstones: {}, birthday: '', birthdayUpdatedAt: '', categories: [], categoriesUpdatedAt: '', ...extra })
const ME = { id: 'me', name: 'Me', created_at: '1970-01-01T00:00:00.000Z', updated_at: '1970-01-01T00:00:00.000Z' }
const payload = (life, writers) => ({ ...(writers ? { writers } : {}), lives: { default: emptyLife(life) } })

describe('Lives in the file tier', () => {
  it('merges Life records, honours Life tombstones, and never drops Me', async () => {
    const { mergePayloads } = await import('./adapter.js')
    const local  = payload({ lifeRecords: [ME, { id: 'L1', name: 'Mom', updated_at: T1 }], lifeTombstones: {} })
    const remote = payload({ lifeRecords: [ME, { id: 'L1', name: 'Mother', updated_at: T2 }, { id: 'L2', name: 'Dad', updated_at: T1 }], lifeTombstones: { L2: T3, me: T3 } })
    const { data } = mergePayloads(local, remote)
    expect(data.lives.default.lifeRecords.map(l => `${l.id}:${l.name}`).sort()).toEqual(['L1:Mother', 'me:Me'])
  })

  it('a file from an older build (no Life records) keeps this device\'s Lives and gets them written', async () => {
    const { mergePayloads } = await import('./adapter.js')
    const local  = payload({ lifeRecords: [ME, { id: 'L1', name: 'Mom', updated_at: T1 }], lifeTombstones: {} })
    const r = mergePayloads(local, payload({}))
    expect(r.data.lives.default.lifeRecords.map(l => l.id).sort()).toEqual(['L1', 'me'])
    expect(r.remoteChanged).toBe(true)
  })

  it('merges a milestone\'s Lives per Life when both sides changed them', async () => {
    const { mergePayloads } = await import('./adapter.js')
    const { lifeIdsOf } = await import('../data/lifeMembership.js')
    const l = milestone('w', { updated_at: T2, lifeOps: { me: { op: 'add', at: T1 }, mom: { op: 'add', at: T2 } } })
    const r = milestone('w', { updated_at: T3, lifeOps: { me: { op: 'add', at: T1 }, dad: { op: 'add', at: T3 } } })
    const a = mergePayloads(payload({ milestones: [l] }), payload({ milestones: [r] })).data
    const b = mergePayloads(payload({ milestones: [r] }), payload({ milestones: [l] })).data
    expect(lifeIdsOf(a.lives.default.milestones[0])).toEqual(['dad', 'me', 'mom'])
    expect(a.lives.default.milestones).toEqual(b.lives.default.milestones)
  })

  it('applies Life records to the store, leaves them alone for a file without any, and never deletes Me', async () => {
    const db = await import('../data/db.js')
    await db.initDB()
    const { makeApplyPayload } = await import('./adapter.js')
    const apply = makeApplyPayload(() => {}, () => {})
    await apply(payload({ lifeRecords: [{ id: 'L1', name: 'Mom', updated_at: T1 }], lifeTombstones: { L9: T1 } }))
    expect((await db.dbGetAllLives()).map(l => l.id).sort()).toEqual(['L1', 'me'])
    expect(JSON.parse(localStorage.getItem('lifeglance-life-tombstones'))).toEqual({ L9: T1 })
    await apply(payload({}))
    expect((await db.dbGetAllLives()).map(l => l.id).sort()).toEqual(['L1', 'me'])
  })

  it('the sync and backup payloads carry the Life records', async () => {
    const db = await import('../data/db.js')
    await db.initDB()
    await db.dbPutLife({ id: 'L1', name: 'Mom', updated_at: T1 })
    const { buildBackupPayload } = await import('./adapter.js')
    const p = await buildBackupPayload()
    expect(p.lives.default.lifeRecords.map(l => l.id).sort()).toEqual(['L1', 'me'])
    expect(p.lives.default.lifeTombstones).toEqual({})
  })
})

describe('the Lives gate in the file tier', () => {
  const today = () => new Date().toISOString().slice(0, 10)
  const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10)
  const own = () => ({ mine: { schema: 2, app: '5.0.0', platform: 'web', day: today() } })

  it("counts every other device's entry, dated by its day", async () => {
    const { mergePayloads } = await import('./adapter.js')
    const gate = await import('./lifeGate.js')
    mergePayloads(payload({}, own()), payload({}, { tablet: { schema: 1, app: '4.1.0', platform: 'ios', day: daysAgo(3) }, mac: { schema: 2, day: today() } }))
    expect(gate.blockingWriters().map(w => w.key)).toEqual(['tablet'])
  })

  it('a file that lost this device\'s own recent entry was rewritten by an older client', async () => {
    const { mergePayloads } = await import('./adapter.js')
    const gate = await import('./lifeGate.js')
    mergePayloads(payload({}, own()), payload({}, own()), { fileKey: 'icloud' })     // own entry is in the file
    expect(gate.canUseMultipleLives()).toBe(true)
    mergePayloads(payload({}, own()), payload({}), { fileKey: 'icloud' })            // ...and now it is gone
    expect(gate.blockingWriters().map(w => w.key)).toEqual(['legacy:file:icloud'])
  })

  it('keeps each file apart: an entry seen in one file says nothing about another', async () => {
    const { mergePayloads } = await import('./adapter.js')
    const gate = await import('./lifeGate.js')
    mergePayloads(payload({}, own()), payload({}, own()), { fileKey: 'webdav' })
    mergePayloads(payload({}, own()), payload({}), { fileKey: 'icloud' })            // never seen in iCloud
    expect(gate.canUseMultipleLives()).toBe(true)
  })

  it('an entry pruned after this device was away 60 days is not taken for an older client', async () => {
    const { mergePayloads } = await import('./adapter.js')
    const gate = await import('./lifeGate.js')
    localStorage.setItem('lifeglance-own-writer-seen:webdav', daysAgo(61))
    mergePayloads(payload({}, own()), payload({}), { fileKey: 'webdav' })
    expect(gate.canUseMultipleLives()).toBe(true)
  })
})

describe('adding a Life', () => {
  it('is refused while an older device has synced in the last 60 days, and allowed once none has', async () => {
    const db = await import('../data/db.js')
    await db.initDB()
    const gate = await import('./lifeGate.js')
    const lives = await import('../data/lives.js')
    gate.recordWriter('old-phone', { schema: 1, app: '4.1.0', platform: 'android' }, Date.now() - DAY)
    await expect(lives.createLife({ name: 'Mom' })).rejects.toBeInstanceOf(gate.MultipleLivesBlockedError)
    gate.recordWriter('old-phone', { schema: 2 }, Date.now())
    await expect(lives.createLife({ name: 'Mom' })).resolves.toMatchObject({ name: 'Mom' })
  })

  it('marks the new Life, its edits and its deletion for sync', async () => {
    const db = await import('../data/db.js')
    await db.initDB()
    const dirty = await import('./dirty.js')
    const lives = await import('../data/lives.js')
    const marked = []
    dirty.registerDirtyTarget({ markDirty: (id) => marked.push(id) })
    const mom = await lives.createLife({ name: 'Mom' })
    await lives.updateLife(mom.id, { name: 'Mother' }, mom)
    await lives.deleteLife(mom.id)
    expect(marked.filter(id => id === mom.id)).toHaveLength(3)
    expect(marked).toContain('life:default:lifeTombstones')
  })
})

// ── Relationships (Phase 4) ─────────────────────────────────────────────────

const edge = (id, extra = {}) => ({ id, fromLifeId: 'me', toLifeId: 'L1', type: 'parent', relationshipNote: '', created_at: T1, updated_at: T1, ...extra })

describe('relationship edges on the vault', () => {
  it('an edge added on one device reaches the other, and a later edit wins', async () => {
    const v = vault()
    const a = await device(v, 'A'), b = await device(v, 'B')
    a.store.relationships.put(edge('E1')); a.dirty.add('E1')
    await converge([a, b])
    expect(b.store.relationships.get('E1')).toEqual(edge('E1'))
    expect(v.rows.get('E1').env._kind).toBe('relationship')
    b.store.relationships.put(edge('E1', { type: 'sibling', updated_at: T2 })); b.dirty.add('E1')
    a.store.relationships.put(edge('E1', { type: 'other', updated_at: T3 })); a.dirty.add('E1')
    await converge([a, b])
    expect(a.store.relationships.get('E1').type).toBe('other')
    expect(b.store.relationships.get('E1').type).toBe('other')
  })

  it('a deleted edge is deleted on the other device, and the tombstones merge as a bundle', async () => {
    const v = vault()
    const a = await device(v, 'A'), b = await device(v, 'B')
    a.store.relationships.put(edge('E1')); a.dirty.add('E1')
    await converge([a, b])
    a.store.relationships.delete('E1'); a.dirty.add('E1')
    a.store.putBundle('relationshipTombstones', { value: { E1: T2 } }); a.dirty.add('life:default:relationshipTombstones')
    b.store.putBundle('relationshipTombstones', { value: { E9: T2 } }); b.dirty.add('life:default:relationshipTombstones')
    await converge([a, b])
    expect(b.store.relationships.get('E1')).toBeNull()
    for (const d of [a, b]) expect(d.store.getBundle('relationshipTombstones').value).toEqual({ E1: T2, E9: T2 })
  })

  it('a fresh device uploads its edges with everything else', async () => {
    const { makeDbAdapter } = await import('./dbAdapter.js')
    const store = memStore()
    store.relationships.put(edge('E1'))
    const ids = await makeDbAdapter({ store }).allEntityIds()
    expect(ids).toContain('E1')
    expect(ids).toContain('life:default:relationshipTombstones')
  })
})

describe('relationship edges in the file tier', () => {
  it('merges edges by id, newest wins, and honours tombstones from either side', async () => {
    const { mergePayloads } = await import('./adapter.js')
    const local  = payload({ relationships: [edge('E1'), edge('E2', { toLifeId: 'L2' })], relationshipTombstones: {} })
    const remote = payload({ relationships: [edge('E1', { type: 'child', updated_at: T2 })], relationshipTombstones: { E2: T3 } })
    const a = mergePayloads(local, remote)
    const b = mergePayloads(remote, local)
    expect(a.data.lives.default.relationships).toEqual([edge('E1', { type: 'child', updated_at: T2 })])
    expect(a.data.lives.default.relationshipTombstones).toEqual({ E2: T3 })
    expect(b.data.lives.default.relationships).toEqual(a.data.lives.default.relationships)
    expect(a.localChanged).toBe(true)
  })

  it('a file from an older build (no edges) keeps this device\'s edges and gets them written', async () => {
    const { mergePayloads } = await import('./adapter.js')
    const r = mergePayloads(payload({ relationships: [edge('E1')], relationshipTombstones: {} }), payload({}))
    expect(r.data.lives.default.relationships).toEqual([edge('E1')])
    expect(r.remoteChanged).toBe(true)
  })

  it('applies edges to the store, and leaves them alone for a file without any', async () => {
    const db = await import('../data/db.js')
    await db.initDB()
    await db.dbPutRelationship(edge('OLD'))
    const { makeApplyPayload } = await import('./adapter.js')
    const apply = makeApplyPayload(() => {}, () => {})
    await apply(payload({ relationships: [edge('E1')], relationshipTombstones: { OLD: T2 } }))
    expect((await db.dbGetAllRelationships()).map(e => e.id)).toEqual(['E1'])
    expect(JSON.parse(localStorage.getItem('lifeglance-relationship-tombstones'))).toEqual({ OLD: T2 })
    await apply(payload({}))
    expect((await db.dbGetAllRelationships()).map(e => e.id)).toEqual(['E1'])
  })

  it('the sync and backup payloads carry the edges', async () => {
    const db = await import('../data/db.js')
    await db.initDB()
    await db.dbPutRelationship(edge('E1'))
    const { buildBackupPayload, buildPayload } = await import('./adapter.js')
    for (const p of [await buildBackupPayload(), await buildPayload()]) {
      expect(p.lives.default.relationships).toEqual([edge('E1')])
      expect(p.lives.default.relationshipTombstones).toEqual({})
    }
  })
})

// ── Shared chapters ─────────────────────────────────────────────────────────

describe("a chapter's Lives on both tiers", () => {
  const chapter = (id, extra = {}) => ({ id, title: id, start: T1, end: null, color: '#fff', milestoneIds: [], memberOps: {}, created_at: T1, updated_at: T1, ...extra })
  const lifeOps = (o) => Object.fromEntries(Object.entries(o).map(([id, [op, at]]) => [id, { op, at }]))

  it('vault: Mom shared on one device and Dad on the other, both kept, and it settles', async () => {
    const v = vault()
    const a = await device(v, 'A'), b = await device(v, 'B')
    a.store.chapters.put(chapter('c')); a.dirty.add('c')
    await converge([a, b])
    a.store.chapters.put(chapter('c', { updated_at: T2, lifeOps: lifeOps({ me: ['add', T1], mom: ['add', T2] }) })); a.dirty.add('c')
    b.store.chapters.put(chapter('c', { updated_at: T3, lifeOps: lifeOps({ me: ['add', T1], dad: ['add', T3] }) })); b.dirty.add('c')
    const rounds = await converge([a, b])
    const { chapterLifeIds } = await import('../data/lifeMembership.js')
    expect(chapterLifeIds(a.store.chapters.get('c'))).toEqual(['dad', 'me', 'mom'])
    expect(a.store.chapters.get('c')).toEqual(b.store.chapters.get('c'))
    expect(rounds).toBeLessThan(4)
  })

  it('vault: a pre-release single lifeId merges as that one Life, and is replaced by lifeOps', async () => {
    const { mergeChapters } = await import('./dbAdapter.js')
    const merged = mergeChapters(chapter('c', { lifeId: 'mom' }), chapter('c', { updated_at: T2, lifeOps: lifeOps({ mom: ['add', T1], me: ['add', T2] }) }))
    expect(merged).not.toHaveProperty('lifeId')
    expect(Object.keys(merged.lifeOps).sort()).toEqual(['me', 'mom'])
  })

  it('vault: a chapter with no Lives on either side stays exactly as it was', async () => {
    const { mergeChapters } = await import('./dbAdapter.js')
    expect(mergeChapters(chapter('c'), chapter('c'))).not.toHaveProperty('lifeOps')
  })

  it("file tier: merges a chapter's Lives per Life when both sides changed them", async () => {
    const { mergePayloads } = await import('./adapter.js')
    const { chapterLifeIds } = await import('../data/lifeMembership.js')
    const l = chapter('c', { updated_at: T2, lifeOps: lifeOps({ me: ['add', T1], mom: ['add', T2] }) })
    const r = chapter('c', { updated_at: T3, lifeOps: lifeOps({ me: ['add', T1], dad: ['add', T3] }) })
    const a = mergePayloads(payload({ chapters: [l] }), payload({ chapters: [r] })).data
    expect(chapterLifeIds(a.lives.default.chapters[0])).toEqual(['dad', 'me', 'mom'])
    // Chapters without Lives keep the whole-record merge.
    const plain = mergePayloads(payload({ chapters: [chapter('p', { title: 'old' })] }), payload({ chapters: [chapter('p', { title: 'new', updated_at: T2 })] })).data
    expect(plain.lives.default.chapters[0]).toEqual(chapter('p', { title: 'new', updated_at: T2 }))
  })
})
