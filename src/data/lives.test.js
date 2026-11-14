import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

// Lives Phase 2a: the local data model. Source of truth for the rules tested
// here: docs/lifeGLANCE-app-spec.md (Lives v5.0, open questions 6-8).

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
  const ch = await import('./chapters')
  const lives = await import('./lives')
  const lm = await import('./lifeMembership')
  const h = await import('./undoHistory')
  const dirty = await import('../sync/dirty')
  await db.initDB()
  const dirtied = []
  dirty.registerDirtyTarget({ markDirty: id => dirtied.push(id) })
  return { db, ms, ch, lives, lm, h, dirtied }
}

const later = () => new Promise(r => setTimeout(r, 3))

// ── Migration ───────────────────────────────────────────────────────────────

describe('IndexedDB v7 migration', () => {
  it('a fresh install has the Me Life and nothing else', async () => {
    const { db } = await setup()
    expect(await db.dbGetAllLives()).toEqual([{ ...db.ME_LIFE_RECORD }])
  })

  it('upgrading a v6 database adds Me and leaves milestones and chapters untouched', async () => {
    // Build a v6 database the way 4.x left it.
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('lifeglance', 6)
      req.onupgradeneeded = (e) => {
        const d = e.target.result
        d.createObjectStore('milestones', { keyPath: 'id' }).put({ id: 'm1', title: 'Old', updated_at: '2020-01-01T00:00:00.000Z' })
        d.createObjectStore('media', { keyPath: 'id' })
        d.createObjectStore('chapters', { keyPath: 'id' }).put({ id: 'c1', title: 'School', milestoneIds: ['m1'] })
      }
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
    const { db, lives } = await setup()
    expect(await db.dbGetAll()).toEqual([{ id: 'm1', title: 'Old', updated_at: '2020-01-01T00:00:00.000Z' }])
    expect(await db.dbGetAllChapters()).toEqual([{ id: 'c1', title: 'School', milestoneIds: ['m1'] }])
    expect((await lives.loadLives()).map(l => l.id)).toEqual(['me'])
  })

  it('is safe to repeat, and two devices create the identical Me record', async () => {
    const a = await setup()
    const first = await a.db.dbGetAllLives()
    vi.resetModules()
    const again = await import('./db')
    await again.initDB()
    expect(await again.dbGetAllLives()).toEqual(first)
    expect(first[0]).toEqual({ id: 'me', name: 'Me', created_at: '1970-01-01T00:00:00.000Z', updated_at: '1970-01-01T00:00:00.000Z' })
  })
})

// ── Membership ──────────────────────────────────────────────────────────────

describe('which Lives a milestone belongs to', () => {
  it('a record with no lifeOps belongs to Me', async () => {
    const { lm } = await setup()
    expect(lm.lifeIdsOf({ id: 'x' })).toEqual(['me'])
  })

  it('reads the present Lives from lifeOps, and falls back to Me when none is present', async () => {
    const { lm } = await setup()
    const at = '2026-01-01T00:00:00.000Z'
    expect(lm.lifeIdsOf({ lifeOps: { mom: { op: 'add', at }, me: { op: 'add', at } } })).toEqual(['me', 'mom'])
    expect(lm.lifeIdsOf({ lifeOps: { mom: { op: 'add', at }, me: { op: 'remove', at } } })).toEqual(['mom'])
    expect(lm.lifeIdsOf({ lifeOps: { mom: { op: 'remove', at }, me: { op: 'remove', at } } })).toEqual(['me'])
  })

  it('adding a Life to a pre-Lives milestone keeps Me, as one op each', async () => {
    const { ms, lives, lm, dirtied } = await setup()
    const m = await ms.addMilestone({ title: 'Wedding', date: '2015-06-01', category: 'family' })
    const mom = await lives.createLife({ name: 'Mom' })
    const u = await lives.addLifeToMilestone(m, mom.id)
    expect(lm.lifeIdsOf(u).sort()).toEqual(['me', mom.id].sort())
    expect(u.lifeOps.me).toEqual({ op: 'add', at: m.created_at })     // seeded, outranked by any later op
    expect(u.lifeOps[mom.id].op).toBe('add')
    expect(u.color).toBe(m.color)
    expect(dirtied).toContain(m.id)
  })

  it('refuses to remove the last Life', async () => {
    const { ms, lives } = await setup()
    const m = await ms.addMilestone({ title: 'x', date: '2015-06-01' })
    await expect(lives.removeLifeFromMilestone(m, 'me')).rejects.toThrow(/at least one Life/)
  })

  it("removing a Life also takes the milestone out of that Life's chapters", async () => {
    const { ms, ch, lives, db } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    let m = await ms.addMilestone({ title: 'Trip', date: '2015-06-01' })
    m = await lives.addLifeToMilestone(m, mom.id)
    const momChapter = await ch.updateChapter((await ch.createChapter({ title: 'Mom travels', start: '2015-01-01', color: '#000' })).id, { lifeId: mom.id }, await db.dbGetChapter((await db.dbGetAllChapters())[0].id))
    const meChapter = await ch.createChapter({ title: 'My travels', start: '2015-01-01', color: '#000' })
    await ch.addMilestoneToChapter(momChapter.id, m.id)
    await ch.addMilestoneToChapter(meChapter.id, m.id)
    await lives.removeLifeFromMilestone(m, mom.id)
    expect((await db.dbGetChapter(momChapter.id)).milestoneIds).toEqual([])
    expect((await db.dbGetChapter(meChapter.id)).milestoneIds).toEqual([m.id])
  })
})

describe('which Lives a chapter belongs to', () => {
  it("accepts a milestone that shares a Life with the chapter, and refuses others", async () => {
    const { ms, ch, lives, lm } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    const momChapter = await ch.createChapter({ title: 'University', start: '2010-01-01', color: '#000', ...lm.newChapterLifeFields(mom.id) })
    const mine = await ms.addMilestone({ title: 'Mine', date: '2011-01-01' })
    const shared = await lives.addLifeToMilestone(await ms.addMilestone({ title: 'Shared', date: '2012-01-01' }), mom.id)
    await expect(ch.addMilestoneToChapter(momChapter.id, mine.id)).rejects.toThrow(/none of this chapter's Lives/)
    expect((await ch.addMilestoneToChapter(momChapter.id, shared.id)).milestoneIds).toEqual([shared.id])
  })

  it('a chapter shared by Me and Mom holds a milestone of either, and shows in both', async () => {
    const { ms, ch, lives, lm } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    const c = await ch.createChapter({ title: 'Our house', start: '2010-01-01', color: '#000', ...lm.newChapterLifeFields(['me', mom.id]) })
    const mine = await ms.addMilestone({ title: 'Mine', date: '2011-01-01' })
    const hers = await ms.addMilestone({ title: 'Hers', date: '2011-01-01', ...lm.newMilestoneLifeFields(mom.id) })
    await ch.addMilestoneToChapter(c.id, mine.id)
    expect((await ch.addMilestoneToChapter(c.id, hers.id)).milestoneIds.sort()).toEqual([mine.id, hers.id].sort())
    expect(lm.chapterLifeIds(c)).toEqual(['me', mom.id].sort())
    for (const id of ['me', mom.id]) expect(lm.chaptersForLife([c], id)).toHaveLength(1)
  })

  it('a chapter with no Lives belongs to Me; a pre-release single lifeId is still read', async () => {
    const { lm } = await setup()
    expect(lm.chapterLifeIds({ id: 'c' })).toEqual(['me'])
    expect(lm.chapterLifeIds({ id: 'c', lifeId: 'mom' })).toEqual(['mom'])
    expect(lm.chaptersForLife([{ id: 'a' }, { id: 'b', lifeId: 'mom' }], 'me').map(c => c.id)).toEqual(['a'])
  })

  it('changing its Lives writes one op per Life, drops the old lifeId, and lets go of members that no longer fit', async () => {
    const { ms, ch, lives, lm, db, dirtied } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    const c = await ch.createChapter({ title: 'Our house', start: '2010-01-01', color: '#000', ...lm.newChapterLifeFields(['me', mom.id], '2026-01-01T00:00:00.000Z') })
    const mine = await ms.addMilestone({ title: 'Mine', date: '2011-01-01' })
    const hers = await ms.addMilestone({ title: 'Hers', date: '2011-01-01', ...lm.newMilestoneLifeFields(mom.id) })
    await ch.addMilestoneToChapter(c.id, mine.id)
    await ch.addMilestoneToChapter(c.id, hers.id)
    await later()
    const u = await lives.setChapterLife(await db.dbGetChapter(c.id), 'me', false)
    expect(lm.chapterLifeIds(u)).toEqual([mom.id])
    expect(u.lifeOps.me.op).toBe('remove')
    expect(u.lifeOps[mom.id].at).toBe('2026-01-01T00:00:00.000Z')   // untouched
    expect(u.milestoneIds).toEqual([hers.id])
    expect(u.memberOps[mine.id].op).toBe('remove')
    expect(dirtied).toContain(c.id)
    await expect(lives.setChapterLife(u, mom.id, false)).rejects.toThrow(/at least one Life/)
    const legacy = await ch.updateChapter(c.id, lives.chapterLivesUpdate({ ...u, lifeOps: undefined, lifeId: mom.id }, [mom.id, 'me'], []), { ...u, lifeId: mom.id })
    expect(legacy).not.toHaveProperty('lifeId')
    expect(lm.chapterLifeIds(legacy)).toEqual(['me', mom.id].sort())
  })

  it("a milestone that leaves a Life leaves only the chapters it no longer shares a Life with", async () => {
    const { ms, ch, lives, lm, db } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    const both = await ch.createChapter({ title: 'Both', start: '2010-01-01', color: '#000', ...lm.newChapterLifeFields(['me', mom.id]) })
    const momOnly = await ch.createChapter({ title: 'Hers', start: '2010-01-01', color: '#000', ...lm.newChapterLifeFields(mom.id) })
    const m = await lives.addLifeToMilestone(await ms.addMilestone({ title: 'Shared', date: '2011-01-01' }), mom.id)
    await ch.addMilestoneToChapter(both.id, m.id)
    await ch.addMilestoneToChapter(momOnly.id, m.id)
    await lives.removeLifeFromMilestone(m, mom.id)
    expect((await db.dbGetChapter(both.id)).milestoneIds).toEqual([m.id])
    expect((await db.dbGetChapter(momOnly.id)).milestoneIds).toEqual([])
  })
})

// ── Life records ────────────────────────────────────────────────────────────

describe('Life records', () => {
  it('lists Me first, then by name, and puts Me back if it went missing', async () => {
    const { db, lives } = await setup()
    await lives.createLife({ name: 'Zed' })
    await lives.createLife({ name: 'Ann' })
    expect((await lives.loadLives()).map(l => l.name)).toEqual(['Me', 'Ann', 'Zed'])
    await db.dbDeleteLife('me')
    expect((await lives.loadLives())[0]).toEqual({ ...db.ME_LIFE_RECORD })
  })

  it('needs a name', async () => {
    const { lives } = await setup()
    await expect(lives.createLife({ name: '  ' })).rejects.toThrow(/name/)
  })

  it("Me keeps its name; its nickname can change; its birth date is the existing birthday setting", async () => {
    const { lives, dirtied } = await setup()
    const me = await lives.getLife('me')
    const u = await lives.updateLife('me', { name: 'Jason', nickname: 'J', birthDate: '1990-04-05' }, me)
    expect(u.name).toBe('Me')
    expect(u.nickname).toBe('J')
    expect(u).not.toHaveProperty('birthDate')
    expect(localStorage.getItem('lifeglance-birthday')).toBe('1990-04-05')
    expect(lives.lifeBirthDate(u)).toBe('1990-04-05')
    expect(dirtied).toContain('life:default:birthday')
  })

  it('another Life keeps its own birth date and can be renamed', async () => {
    const { lives } = await setup()
    const mom = await lives.createLife({ name: 'Mom', birthDate: '1960-03-04' })
    const u = await lives.updateLife(mom.id, { name: ' Mother ' }, mom)
    expect(u.name).toBe('Mother')
    expect(lives.lifeBirthDate(u)).toBe('1960-03-04')
  })
})

describe('deleting a Life', () => {
  it('cannot delete Me', async () => {
    const { lives } = await setup()
    await expect(lives.deleteLife('me')).rejects.toThrow(/cannot be deleted/)
  })

  it('deletes its unshared milestones and its chapters; shared milestones only lose it', async () => {
    const { ms, ch, lives, lm, db } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    const onlyMom = await ms.addMilestone({ title: 'Mom PhD', date: '1990-01-01' })
    await lives.addLifeToMilestone(onlyMom, mom.id)
    await lives.removeLifeFromMilestone(await db.dbGet(onlyMom.id), 'me')
    const shared = await lives.addLifeToMilestone(await ms.addMilestone({ title: 'Wedding', date: '2015-01-01' }), mom.id)
    const mine = await ms.addMilestone({ title: 'Mine', date: '2016-01-01' })
    const momChapter = await ch.createChapter({ title: 'Mom career', start: '1990-01-01', color: '#000' })
    await ch.updateChapter(momChapter.id, { lifeId: mom.id }, await db.dbGetChapter(momChapter.id))
    const meChapter = await ch.createChapter({ title: 'Mine', start: '2016-01-01', color: '#000' })

    const result = await lives.deleteLife(mom.id)
    expect(result.deletedMilestoneIds).toEqual([onlyMom.id])
    expect(result.deletedChapterIds).toEqual([momChapter.id])
    expect(await db.dbGet(onlyMom.id)).toBeNull()
    expect(lm.lifeIdsOf(await db.dbGet(shared.id))).toEqual(['me'])
    expect(await db.dbGet(mine.id)).not.toBeNull()
    expect((await db.dbGetAllChapters()).map(c => c.id)).toEqual([meChapter.id])
    expect(await lives.getLife(mom.id)).toBeNull()
    expect(lives.getLifeTombstones()[mom.id]).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('lifeglance-milestone-tombstones'))[onlyMom.id]).toBeTruthy()
  })
})

// ── Undo ────────────────────────────────────────────────────────────────────

describe('undo of a membership change', () => {
  it('records the Lives added or removed, not the whole set', async () => {
    const { h } = await setup()
    const at = '2026-01-01T00:00:00.000Z'
    const b = { id: 'm', title: 'x' }
    const a = { id: 'm', title: 'x', lifeOps: { me: { op: 'add', at }, mom: { op: 'add', at } } }
    expect(h.diffMilestones([b], [a]).changed).toEqual([{ id: 'm', before: {}, after: {}, lives: { add: ['mom'], remove: [] } }])
  })

  it("undo and redo replay just that Life, leaving another device's change to a different Life alone", async () => {
    const { ms, lives, lm, h, db } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    const dad = await lives.createLife({ name: 'Dad' })
    const m = await ms.addMilestone({ title: 'Wedding', date: '2015-06-01' })
    const withMom = await lives.addLifeToMilestone(m, mom.id)
    const hist = h.createHistory()
    h.record(hist, h.diffMilestones([m], [withMom]))
    await later()
    // Meanwhile another device adds Dad.
    await lives.addLifeToMilestone(await db.dbGet(m.id), dad.id)

    await later()
    await h.undo(hist)
    expect(lm.lifeIdsOf(await db.dbGet(m.id)).sort()).toEqual(['me', dad.id].sort())
    await later()
    await h.redo(hist)
    expect(lm.lifeIdsOf(await db.dbGet(m.id)).sort()).toEqual(['me', dad.id, mom.id].sort())
  })
})

// ── One Life's view ─────────────────────────────────────────────────────────

describe("folding one Life's view back into the full list", () => {
  const inMe = (x) => x.life === 'me'
  const all = [{ id: 'a', life: 'me' }, { id: 'b', life: 'mom' }, { id: 'c', life: 'me' }]

  it('keeps the other Lives when the view is replaced or updated', async () => {
    const { lm } = await setup()
    expect(lm.applyScopedUpdate(all, [{ id: 'a', life: 'me', t: 1 }], inMe).map(x => x.id)).toEqual(['b', 'a'])
    expect(lm.applyScopedUpdate(all, v => v.filter(x => x.id !== 'c'), inMe).map(x => x.id)).toEqual(['b', 'a'])
  })

  it('does not duplicate a record that moved into the view', async () => {
    const { lm } = await setup()
    const out = lm.applyScopedUpdate(all, v => [...v, { id: 'b', life: 'me' }], inMe)
    expect(out.filter(x => x.id === 'b')).toEqual([{ id: 'b', life: 'me' }])
  })
})

// ── Phase 3a: new records in the current Life, and the delete confirmation ──

describe('new records in a Life', () => {
  it("a milestone or chapter made in Me looks exactly like one from before Lives", async () => {
    const { ms, ch, lm } = await setup()
    expect(lm.newMilestoneLifeFields('me')).toEqual({})
    expect(lm.newChapterLifeFields('me')).toEqual({})
    const m = await ms.addMilestone({ title: 'x', date: '2015-06-01', ...lm.newMilestoneLifeFields('me') })
    const c = await ch.createChapter({ title: 'y', start: '2015-01-01', color: '#000', ...lm.newChapterLifeFields('me') })
    expect(m).not.toHaveProperty('lifeOps')
    expect(c).not.toHaveProperty('lifeId')
    expect(c).not.toHaveProperty('lifeOps')
  })

  it('one made in another Life belongs to that Life only', async () => {
    const { ms, ch, lm } = await setup()
    const m = await ms.addMilestone({ title: 'x', date: '2015-06-01', ...lm.newMilestoneLifeFields('mom') })
    const c = await ch.createChapter({ title: 'y', start: '2015-01-01', color: '#000', ...lm.newChapterLifeFields('mom') })
    expect(lm.lifeIdsOf(m)).toEqual(['mom'])
    expect(lm.chapterLifeIds(c)).toEqual(['mom'])
  })
})

describe('what deleting a Life would do', () => {
  it('counts milestones and chapters only it has, and shared ones', async () => {
    const { lm } = await setup()
    const at = '2026-01-01T00:00:00.000Z'
    const milestones = [
      { id: 'a', lifeOps: { mom: { op: 'add', at } } },
      { id: 'b', lifeOps: { mom: { op: 'add', at }, me: { op: 'add', at } } },
      { id: 'c' },
    ]
    const chapters = [{ id: 'x', lifeId: 'mom' }, { id: 'y' }, { id: 'z', lifeOps: { mom: { op: 'add', at }, me: { op: 'add', at } } }]
    expect(lm.deleteLifeImpact('mom', milestones, chapters)).toEqual({ only: 1, shared: 1, chapters: 1, chaptersShared: 1 })
    expect(lm.deleteLifeImpact('dad', milestones, chapters)).toEqual({ only: 0, shared: 0, chapters: 0, chaptersShared: 0 })
  })
})

// ── Phase 3b: a new milestone in several Lives, and undo of a sheet edit ────

describe('a new milestone in several Lives', () => {
  it('records each chosen Life, and stays plain for Me alone', async () => {
    const { lm } = await setup()
    expect(lm.newMilestoneLifeFields(['me'])).toEqual({})
    const f = lm.newMilestoneLifeFields(['me', 'mom', 'mom'], 'T')
    expect(f).toEqual({ lifeOps: { me: { op: 'add', at: 'T' }, mom: { op: 'add', at: 'T' } } })
  })
})

describe('undo of an edit that moves a milestone off the Life on screen', () => {
  it('is recorded as a Life change (not a delete) and undoes as one', async () => {
    const { ms, lives, lm, h, db } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    const m = await ms.addMilestone({ title: 'Trip', date: '2015-06-01' })
    // What executeSave does for "Lives: Mom" on a milestone shown in Me: add
    // Mom, then remove Me; the new list is the old one with the record replaced.
    let updated = await lives.setMilestoneLife(m, mom.id, true)
    updated = await lives.setMilestoneLife(updated, 'me', false)
    const entry = h.diffMilestones([m], [updated])
    expect(entry.removed).toEqual([])
    expect(entry.changed[0].lives).toEqual({ add: [mom.id], remove: ['me'] })
    const hist = h.createHistory()
    h.record(hist, entry)
    await later()
    await h.undo(hist)
    expect(lm.lifeIdsOf(await db.dbGet(m.id))).toEqual(['me'])
  })
})

describe('deleting a Life with shared chapters', () => {
  it('deletes the chapters only it has; shared ones stay, without it and without members that no longer fit', async () => {
    const { ms, ch, lives, lm, db } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    const hers = await ch.createChapter({ title: 'Hers', start: '2010-01-01', color: '#000', ...lm.newChapterLifeFields(mom.id) })
    const ours = await ch.createChapter({ title: 'Ours', start: '2010-01-01', color: '#000', ...lm.newChapterLifeFields(['me', mom.id]) })
    const mine = await ms.addMilestone({ title: 'Mine', date: '2011-01-01' })
    const herM = await ms.addMilestone({ title: 'Her move', date: '2011-01-01', ...lm.newMilestoneLifeFields(mom.id) })
    await ch.addMilestoneToChapter(ours.id, mine.id)
    await ch.addMilestoneToChapter(ours.id, herM.id)
    expect(lm.deleteLifeImpact(mom.id, await db.dbGetAll(), await db.dbGetAllChapters())).toMatchObject({ chapters: 1, chaptersShared: 1 })
    const r = await lives.deleteLife(mom.id)
    expect(r.deletedChapterIds).toEqual([hers.id])
    expect(r.updatedChapters.map(c => c.id)).toEqual([ours.id])
    const kept = await db.dbGetChapter(ours.id)
    expect(lm.chapterLifeIds(kept)).toEqual(['me'])
    expect(kept.milestoneIds).toEqual([mine.id])
  })
})
