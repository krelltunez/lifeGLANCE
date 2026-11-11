import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

// Lives Phase 4: relationships as directed edges, and the one picker v5.0
// offers ("relationship to Me"). Source of truth: docs/lifeGLANCE-app-spec.md,
// "Relationships: stored as edges".

beforeEach(() => {
  global.indexedDB = new IDBFactory()
  const store = new Map()
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: k => { store.delete(k) },
    clear: () => store.clear(),
  }
  vi.resetModules()
})

async function setup() {
  const db = await import('./db')
  const ms = await import('./milestones')
  const lives = await import('./lives')
  const rel = await import('./relationships')
  const dirty = await import('../sync/dirty')
  const tomb = await import('../sync/tombstones')
  await db.initDB()
  const dirtied = []
  dirty.registerDirtyTarget({ markDirty: id => dirtied.push(id) })
  return { db, ms, lives, rel, tomb, dirtied }
}

const later = () => new Promise(r => setTimeout(r, 3))

describe('IndexedDB v8 migration', () => {
  it('upgrading a v7 database adds an empty relationships store and keeps the Lives', async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('lifeglance', 7)
      req.onupgradeneeded = (e) => {
        const d = e.target.result
        d.createObjectStore('milestones', { keyPath: 'id' }).put({ id: 'm1', title: 'Old' })
        d.createObjectStore('media', { keyPath: 'id' })
        d.createObjectStore('chapters', { keyPath: 'id' })
        const lv = d.createObjectStore('lives', { keyPath: 'id' })
        lv.put({ id: 'me', name: 'Me', created_at: '1970-01-01T00:00:00.000Z', updated_at: '1970-01-01T00:00:00.000Z' })
        lv.put({ id: 'L1', name: 'Mom', updated_at: '2026-01-01T00:00:00.000Z' })
      }
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
    const { db } = await setup()
    expect(await db.dbGetAllRelationships()).toEqual([])
    expect((await db.dbGetAllLives()).map(l => l.id).sort()).toEqual(['L1', 'me'])
    expect(await db.dbGetAll()).toEqual([{ id: 'm1', title: 'Old' }])
  })

  it('is safe to repeat', async () => {
    const { db } = await setup()
    await db.dbPutRelationship({ id: 'E1', fromLifeId: 'me', toLifeId: 'L1', type: 'parent' })
    vi.resetModules()
    const again = await import('./db')
    await again.initDB()
    expect((await again.dbGetAllRelationships()).map(e => e.id)).toEqual(['E1'])
  })
})

describe('the edge model', () => {
  it('an edge reads "to is from\'s type" and joins two different Lives', async () => {
    const { rel } = await setup()
    const e = rel.buildRelationship({ fromLifeId: 'me', toLifeId: 'mom', type: 'parent' })
    expect(e).toMatchObject({ fromLifeId: 'me', toLifeId: 'mom', type: 'parent', relationshipNote: '' })
    expect(e.created_at).toBe(e.updated_at)
    expect(() => rel.buildRelationship({ fromLifeId: 'me', toLifeId: 'me', type: 'parent' })).toThrow()
    expect(() => rel.buildRelationship({ fromLifeId: 'me', toLifeId: 'mom', type: 'cousin' })).toThrow()
  })

  it('several edges between the same two Lives are representable', async () => {
    const { rel, db } = await setup()
    await db.dbPutRelationship(rel.buildRelationship({ fromLifeId: 'me', toLifeId: 'sam', type: 'partner' }))
    await db.dbPutRelationship(rel.buildRelationship({ fromLifeId: 'me', toLifeId: 'sam', type: 'other' }))
    await db.dbPutRelationship(rel.buildRelationship({ fromLifeId: 'sam', toLifeId: 'me', type: 'partner' }))
    expect(await rel.listRelationships()).toHaveLength(3)
  })
})

describe('the "relationship to Me" picker', () => {
  it('sets, changes and clears the edge from Me, marking each change for sync', async () => {
    const { rel, tomb, dirtied } = await setup()
    const e = await rel.setRelationshipToMe('mom', 'parent', [])
    expect(e).toMatchObject({ fromLifeId: 'me', toLifeId: 'mom', type: 'parent' })
    await later()
    const changed = await rel.setRelationshipToMe('mom', 'other', await rel.listRelationships())
    expect(changed.id).toBe(e.id)
    expect(changed.type).toBe('other')
    expect(changed.updated_at > e.updated_at).toBe(true)
    expect(await rel.setRelationshipToMe('mom', null, await rel.listRelationships())).toBeNull()
    expect(await rel.listRelationships()).toEqual([])
    expect(Object.keys(tomb.getRelationshipTombstones())).toEqual([e.id])
    expect(dirtied.filter(id => id === e.id)).toHaveLength(3)
    expect(dirtied).toContain('life:default:relationshipTombstones')
  })

  it('setting the same type again writes nothing', async () => {
    const { rel, dirtied } = await setup()
    const e = await rel.setRelationshipToMe('mom', 'parent', [])
    dirtied.length = 0
    expect(await rel.setRelationshipToMe('mom', 'parent', await rel.listRelationships())).toEqual(e)
    expect(dirtied).toEqual([])
  })

  it('shows and changes only the most recent edge from Me, leaving the others alone', async () => {
    const { rel, db } = await setup()
    const old = { ...rel.buildRelationship({ fromLifeId: 'me', toLifeId: 'sam', type: 'partner' }), updated_at: '2026-01-01T00:00:00.000Z' }
    const newer = { ...rel.buildRelationship({ fromLifeId: 'me', toLifeId: 'sam', type: 'sibling' }), updated_at: '2026-02-01T00:00:00.000Z' }
    const reverse = { ...rel.buildRelationship({ fromLifeId: 'sam', toLifeId: 'me', type: 'other' }), updated_at: '2026-03-01T00:00:00.000Z' }
    for (const e of [old, newer, reverse]) await db.dbPutRelationship(e)
    const edges = await rel.listRelationships()
    expect(rel.relationshipToMe('sam', edges).id).toBe(newer.id)
    await rel.setRelationshipToMe('sam', null, edges)
    const left = (await rel.listRelationships()).map(e => e.id).sort()
    expect(left).toEqual([old.id, reverse.id].sort())
    expect(rel.relationshipToMe('sam', await rel.listRelationships()).id).toBe(old.id)
  })
})

describe('deleting a Life', () => {
  it('deletes every edge that touches it, from or to, and no others', async () => {
    const { rel, db, lives, tomb } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    const dad = await lives.createLife({ name: 'Dad' })
    const toMom = await rel.setRelationshipToMe(mom.id, 'parent', [])
    const toDad = await rel.setRelationshipToMe(dad.id, 'parent', [])
    const momDad = rel.buildRelationship({ fromLifeId: mom.id, toLifeId: dad.id, type: 'partner' })
    await db.dbPutRelationship(momDad)
    const { deletedRelationshipIds } = await lives.deleteLife(mom.id)
    expect(deletedRelationshipIds.sort()).toEqual([toMom.id, momDad.id].sort())
    expect((await rel.listRelationships()).map(e => e.id)).toEqual([toDad.id])
    expect(Object.keys(tomb.getRelationshipTombstones()).sort()).toEqual([toMom.id, momDad.id].sort())
  })
})
