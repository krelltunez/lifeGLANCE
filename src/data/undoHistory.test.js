import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

// Fresh in-memory IndexedDB and module registry per test (same pattern as
// milestones.test.js).
// The tests run in node: give tombstones.js an in-memory localStorage.
beforeEach(() => {
  global.indexedDB = new IDBFactory()
  const store = new Map()
  globalThis.localStorage = {
    getItem:    k => (store.has(k) ? store.get(k) : null),
    setItem:    (k, v) => { store.set(k, String(v)) },
    removeItem: k => { store.delete(k) },
    clear:      () => store.clear(),
  }
  vi.resetModules()
})

async function setup() {
  const db = await import('./db')
  const ms = await import('./milestones')
  const h  = await import('./undoHistory')
  const dirty = await import('../sync/dirty')
  const tombs = await import('../sync/tombstones')
  await db.initDB()
  const dirtied = []
  dirty.registerDirtyTarget({ markDirty: id => dirtied.push(id) })
  return { db, ms, h, dirtied, tombs }
}

const photoBlob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })

describe('undo never touches attachments (the media-wipe regression)', () => {
  it('keeps every photo and audio blob, and every media flag, through undo and redo', async () => {
    const { db, ms, h } = await setup()
    const withPhoto = await ms.addMilestone({ title: 'Wedding', date: '2015-06-01', has_photo: true })
    await db.dbPutPhoto(withPhoto.id, photoBlob(), 'image/jpeg')
    const withAudio = await ms.addMilestone({ title: 'Voice note', date: '2016-01-01', media_type: 'audio' })
    await db.dbPutMedia(withAudio.id, photoBlob(), 'audio/mp4')

    const before = await ms.loadMilestones()
    const added = await ms.addMilestone({ title: 'New job', date: '2020-01-01' })
    const hist = h.createHistory()
    h.record(hist, h.diffMilestones(before, [...before, added]))

    await h.undo(hist)
    expect(await db.dbGetPhoto(withPhoto.id)).not.toBeNull()
    expect(await db.dbGetMedia(withAudio.id)).not.toBeNull()
    const afterUndo = await ms.loadMilestones()
    expect(afterUndo.map(m => m.id).sort()).toEqual([withPhoto.id, withAudio.id].sort())
    expect(afterUndo.find(m => m.id === withPhoto.id).has_photo).toBe(true)
    expect(afterUndo.find(m => m.id === withAudio.id).media_type).toBe('audio')

    await h.redo(hist)
    expect(await db.dbGetPhoto(withPhoto.id)).not.toBeNull()
    expect((await ms.loadMilestones()).map(m => m.id)).toContain(added.id)
  })

  it('an edit that only changed attachments records nothing', async () => {
    const { h } = await setup()
    const m = { id: 'a', title: 'x', has_photo: false, photo_id: null, updated_at: '1' }
    const n = { ...m, has_photo: true, photo_id: 'a-photo', updated_at: '2' }
    expect(h.diffMilestones([m], [n])).toBeNull()
  })

  it('undoing an edit keeps the current attachment instead of reviving the old reference', async () => {
    const { ms, h } = await setup()
    const m = await ms.addMilestone({ title: 'Trip', date: '2018-01-01', has_photo: true })
    const edited = await ms.updateMilestone(m.id, { title: 'Road trip', has_photo: false, photo_id: null }, m)
    const hist = h.createHistory()
    h.record(hist, h.diffMilestones([m], [edited]))
    await h.undo(hist)
    const [after] = await ms.loadMilestones()
    expect(after.title).toBe('Trip')
    expect(after.has_photo).toBe(false)
    expect(after.photo_id).toBeNull()
  })
})

describe('undo of an add', () => {
  it('deletes through the normal path: tombstone written, row marked dirty', async () => {
    const { ms, h, dirtied, tombs } = await setup()
    const m = await ms.addMilestone({ title: 'Graduation', date: '2010-05-01' })
    const hist = h.createHistory()
    h.record(hist, h.diffMilestones([], [m]))
    dirtied.length = 0

    const result = await h.undo(hist)
    expect(result.removed.map(r => r.id)).toEqual([m.id])
    expect(await ms.loadMilestones()).toHaveLength(0)
    expect(tombs.getMilestoneTombstones()[m.id]).toBeTruthy()
    expect(dirtied).toContain(m.id)
  })

  it('redo brings back the latest stored version, including media slots set after the add', async () => {
    const { ms, h } = await setup()
    const m = await ms.addMilestone({ title: 'Concert', date: '2019-03-01', has_photo: true })
    const hist = h.createHistory()
    h.record(hist, h.diffMilestones([], [m]))
    // A background vault upload later swaps the placeholder slot for a real hash.
    const hash = 'a'.repeat(64)
    await ms.updateMilestone(m.id, { photo_id: hash }, m)

    await h.undo(hist)
    const { reinstated } = await h.redo(hist)
    expect(reinstated[0].photo_id).toBe(hash)
    const [stored] = await ms.loadMilestones()
    expect(stored.photo_id).toBe(hash)
    expect(stored.created_at).toBe(m.created_at)
  })
})

describe('undo of a delete', () => {
  it('re-creates the milestone with its id, created_at and media, newer than its tombstone', async () => {
    const { db, ms, h, dirtied, tombs } = await setup()
    const m = await ms.addMilestone({ title: 'First home', date: '2012-08-01', has_photo: true })
    await db.dbPutPhoto(m.id, photoBlob(), 'image/jpeg')
    await ms.deleteMilestone(m.id)
    const hist = h.createHistory()
    h.record(hist, h.diffMilestones([m], []))
    await new Promise(r => setTimeout(r, 5)) // tombstone strictly older than the undo
    dirtied.length = 0

    const { reinstated } = await h.undo(hist)
    const [back] = await ms.loadMilestones()
    expect(back.id).toBe(m.id)
    expect(back.created_at).toBe(m.created_at)
    expect(back.has_photo).toBe(true)
    expect(reinstated[0].id).toBe(m.id)
    expect(await db.dbGetPhoto(m.id)).not.toBeNull()
    expect(dirtied).toContain(m.id)

    // The file-tier merge must keep it rather than drop it as deleted.
    const { mergeArrayById } = await import('@glance-apps/sync')
    const tombstone = tombs.getMilestoneTombstones()[m.id]
    expect(new Date(back.updated_at) > new Date(tombstone)).toBe(true)
    const { merged } = mergeArrayById([back], [], { [m.id]: tombstone }, null,
      { idField: 'id', timestampField: 'updated_at' })
    expect(merged.map(x => x.id)).toEqual([m.id])
  })
})

describe('undo of an edit', () => {
  it('reverts only the fields the edit changed and leaves later out-of-band changes alone', async () => {
    const { ms, h } = await setup()
    const m = await ms.addMilestone({ title: 'Job', date: '2014-01-01', note: 'old note', dayglance_linked: true })
    const edited = await ms.updateMilestone(m.id, { title: 'Dream job', date: '2014-01-01' }, m)
    const hist = h.createHistory()
    h.record(hist, h.diffMilestones([m], [edited]))
    // dayGLANCE completes the goal after the edit, outside the history.
    await ms.updateMilestone(m.id, { dayglance_completed: true }, edited)

    await h.undo(hist)
    const [after] = await ms.loadMilestones()
    expect(after.title).toBe('Job')
    expect(after.note).toBe('old note')
    expect(after.dayglance_completed).toBe(true)
  })

  it('takes the colour from the category as it is now', async () => {
    const { ms, h } = await setup()
    const m = await ms.addMilestone({ title: 'Move', date: '2011-01-01', category: 'home' })
    const edited = await ms.updateMilestone(m.id, { category: 'travel', color: '#111111' }, m)
    const hist = h.createHistory()
    h.record(hist, h.diffMilestones([m], [edited]))
    await h.undo(hist, { colorFor: id => (id === 'home' ? '#ABCDEF' : undefined) })
    const [after] = await ms.loadMilestones()
    expect(after.category).toBe('home')
    expect(after.color).toBe('#ABCDEF')
  })

  it('is skipped when the milestone was deleted elsewhere in the meantime', async () => {
    const { ms, h } = await setup()
    const m = await ms.addMilestone({ title: 'A', date: '2011-01-01' })
    const edited = await ms.updateMilestone(m.id, { title: 'B' }, m)
    const hist = h.createHistory()
    h.record(hist, h.diffMilestones([m], [edited]))
    await ms.deleteMilestone(m.id)
    const result = await h.undo(hist)
    expect(result.updated).toHaveLength(0)
    expect(await ms.loadMilestones()).toHaveLength(0)
  })
})

describe('unrelated milestones', () => {
  it('are never touched, including ones synced in after the action', async () => {
    const { db, ms, h } = await setup()
    const mine = await ms.addMilestone({ title: 'Mine', date: '2001-01-01' })
    const hist = h.createHistory()
    h.record(hist, h.diffMilestones([], [mine]))
    // Arrives from another device: written straight to storage, no history.
    const synced = { ...ms.buildMilestone({ title: 'From phone', date: '2002-01-01' }) }
    await db.dbPut(synced)

    await h.undo(hist)
    expect((await ms.loadMilestones()).map(m => m.id)).toEqual([synced.id])
  })
})

describe('history stack', () => {
  it('a new action discards redo, and the stack is capped', async () => {
    const { h } = await setup()
    const hist = h.createHistory()
    const entry = i => ({ added: [{ id: String(i) }], removed: [], changed: [] })
    for (let i = 0; i < h.MAX_HISTORY + 5; i++) h.record(hist, entry(i))
    expect(hist.entries).toHaveLength(h.MAX_HISTORY)
    expect(hist.idx).toBe(h.MAX_HISTORY)
    hist.idx = 3
    h.record(hist, entry('x'))
    expect(hist.entries).toHaveLength(4)
    expect(h.canRedo(hist)).toBe(false)
    h.record(hist, null)
    expect(hist.entries).toHaveLength(4)
  })

  it('applyResult folds a step into the in-memory list', async () => {
    const { h } = await setup()
    const list = [{ id: 'a', t: 1 }, { id: 'b', t: 1 }]
    const out = h.applyResult(list, { removed: [{ id: 'a' }], reinstated: [{ id: 'c' }], updated: [{ id: 'b', t: 2 }] })
    expect(out).toEqual([{ id: 'b', t: 2 }, { id: 'c' }])
  })
})
