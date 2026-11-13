import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}))

// Lives Phase 5a: the JSON backup holds every Life, and restore replaces them.
// Source of truth: docs/lifeGLANCE-app-spec.md, "Decided in Phase 5a".

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

const DAY = 24 * 60 * 60 * 1000
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

async function setup() {
  const db = await import('./db')
  const ms = await import('./milestones')
  const ch = await import('./chapters')
  const lives = await import('./lives')
  const rel = await import('./relationships')
  const backup = await import('./backup')
  const gate = await import('../sync/lifeGate')
  await db.initDB()
  return { db, ms, ch, lives, rel, backup, gate }
}

const photoBytes = async (db, id) => {
  const p = await db.dbGetPhoto(id)
  return p ? [...new Uint8Array(await p.blob.arrayBuffer())] : null
}

// Me with a milestone and a photo; Mom with her own milestone, a shared one, a
// chapter, a photo, and a relationship to Me.
async function family({ db, ms, ch, lives, rel }) {
  localStorage.setItem('lifeglance-birthday', '1990-05-06')
  const mine = await ms.addMilestone({ title: 'Graduated', date: '2012-06-01', category: 'education' })
  const mom = await lives.createLife({ name: 'Mom', birthDate: '1960-03-04' })
  await db.dbPutPhoto(mom.id, new Blob([PNG], { type: 'image/png' }), 'image/png')
  await db.dbPutLife({ ...(await db.dbGetLife(mom.id)), photo_id: `${mom.id}-photo` })
  const hers = await ms.addMilestone({ title: 'Mom retired', date: '2020-01-01', category: 'work', lifeOps: { [mom.id]: { op: 'add', at: '2026-01-01T00:00:00.000Z' } } })
  const shared = await lives.addLifeToMilestone(mine, mom.id)
  await db.dbPutPhoto(mine.id, new Blob([PNG], { type: 'image/png' }), 'image/png')
  await db.dbPut({ ...shared, has_photo: true })
  const chapter = await ch.createChapter({ title: 'Mom in Lisbon', start: '1985-01-01T00:00:00.000Z', end: null, color: '#fff', lifeId: mom.id })
  const edge = await rel.setRelationshipToMe(mom.id, 'parent', [])
  return { mine, mom, hers, shared, chapter, edge }
}

describe('saving a backup', () => {
  it('holds every Life: milestones, chapters, Life records, relationships and photos', async () => {
    const s = await setup()
    const f = await family(s)
    const b = await s.backup.buildBackup()
    expect(b.format).toBe(2)
    expect(b.milestones.map(m => m.title).sort()).toEqual(['Graduated', 'Mom retired'])
    expect(b.chapters.map(c => c.id)).toEqual([f.chapter.id])
    expect(b.lifeRecords.map(l => l.id).sort()).toEqual(['me', f.mom.id].sort())
    expect(b.relationships.map(e => e.id)).toEqual([f.edge.id])
    expect(Object.keys(b.photos)).toEqual([f.mine.id])
    expect(b.photos[f.mine.id]).toMatch(/^data:image\/png;base64,/)
    expect(Object.keys(b.lifePhotos)).toEqual([f.mom.id])
    expect(b.birthday).toBe('1990-05-06')
  })

  it("carries Me's birth date on its record, for matching on import", async () => {
    const s = await setup()
    await family(s)
    const b = await s.backup.buildBackup()
    expect(b.lifeRecords.find(l => l.id === 'me').birthDate).toBe('1990-05-06')
    expect((await s.db.dbGetLife('me')).birthDate).toBeUndefined()   // not stored, only exported
  })
})

describe('restoring a backup', () => {
  it('a format 2 backup restores every Life exactly as it was saved', async () => {
    const s = await setup()
    const f = await family(s)
    const file = JSON.parse(JSON.stringify(await s.backup.buildBackup()))
    const before = {
      milestones: await s.db.dbGetAll(), chapters: await s.db.dbGetAllChapters(),
      lives: await s.db.dbGetAllLives(), edges: await s.db.dbGetAllRelationships(),
    }
    // Change everything after the backup.
    await s.lives.deleteLife(f.mom.id)
    await s.ms.addMilestone({ title: 'After the backup', date: '2025-01-01' })
    await s.lives.createLife({ name: 'Dad' })
    localStorage.setItem('lifeglance-birthday', '1999-01-01')

    await s.backup.restoreBackup(s.backup.readBackup(file))
    const byId = (a) => [...a].sort((x, y) => x.id.localeCompare(y.id))
    expect(byId(await s.db.dbGetAll())).toEqual(byId(before.milestones))
    expect(byId(await s.db.dbGetAllChapters())).toEqual(byId(before.chapters))
    expect(byId(await s.db.dbGetAllLives())).toEqual(byId(before.lives))
    expect(await s.db.dbGetAllRelationships()).toEqual(before.edges)
    expect(localStorage.getItem('lifeglance-birthday')).toBe('1990-05-06')
    expect(await photoBytes(s.db, f.mine.id)).toEqual([...PNG])
    expect(await photoBytes(s.db, f.mom.id)).toEqual([...PNG])
  })

  it('never deletes Me, and keeps Me named Me whatever the file says', async () => {
    const s = await setup()
    await family(s)
    const file = await s.backup.buildBackup()
    file.lifeRecords = [{ ...file.lifeRecords.find(l => l.id === 'me'), name: 'Someone', nickname: 'Jo' }]
    file.relationships = []
    file.milestones = []
    file.chapters = []
    await s.backup.restoreBackup(s.backup.readBackup(file))
    const lives = await s.db.dbGetAllLives()
    expect(lives.map(l => l.id)).toEqual(['me'])
    expect(lives[0]).toMatchObject({ name: 'Me', nickname: 'Jo' })
    expect(lives[0].birthDate).toBeUndefined()
  })

  it('a backup from before Lives replaces milestones and chapters, and leaves Lives, their photos and relationships alone', async () => {
    const s = await setup()
    const f = await family(s)
    const old = {
      milestones: [{ id: 'old1', title: 'From 4.x', date: '2001-01-01T00:00:00.000Z', category: 'family', updated_at: '2020-01-01T00:00:00.000Z' }],
      photos: {}, chapters: [], categories: [], birthday: '1990-05-06',
    }
    await s.backup.restoreBackup(s.backup.readBackup(old))
    expect((await s.db.dbGetAll()).map(m => m.id)).toEqual(['old1'])
    expect((await s.db.dbGetAllLives()).map(l => l.id).sort()).toEqual(['me', f.mom.id].sort())
    expect(await photoBytes(s.db, f.mom.id)).toEqual([...PNG])
    expect((await s.db.dbGetAllRelationships()).map(e => e.id)).toEqual([f.edge.id])
  })

  it('still reads the oldest format, a bare array of milestones', async () => {
    const s = await setup()
    const b = s.backup.readBackup([{ id: 'a', title: 'x', date: '2001-01-01T00:00:00.000Z' }])
    expect(b.lifeRecords).toBeNull()
    await s.backup.restoreBackup(b)
    expect((await s.db.dbGetAll()).map(m => m.id)).toEqual(['a'])
  })

  it('refuses a pre-rename backup and a file that is not a backup', async () => {
    const s = await setup()
    expect(() => s.backup.readBackup({ milestones: [], eras: [] })).toThrow(/Chapters rename/)
    expect(() => s.backup.readBackup({ hello: 1 })).toThrow(/not a lifeGLANCE backup/)
  })
})

describe('restoring while an older device is active', () => {
  it('refuses a file with another Life, changing nothing', async () => {
    const s = await setup()
    await family(s)
    const file = JSON.parse(JSON.stringify(await s.backup.buildBackup()))
    await s.ms.addMilestone({ title: 'Kept', date: '2025-01-01' })
    const before = (await s.db.dbGetAll()).length
    s.gate.recordWriter('old-phone', { schema: 1, app: '4.1.0', platform: 'android' }, Date.now() - DAY)
    await expect(s.backup.restoreBackup(s.backup.readBackup(file))).rejects.toBeInstanceOf(s.gate.MultipleLivesBlockedError)
    expect((await s.db.dbGetAll()).length).toBe(before)
  })

  it('sees another Life in milestones, chapters or relationships too, not only in Life records', async () => {
    const { backup } = await setup()
    const base = { milestones: [], chapters: [], lifeRecords: null, relationships: null }
    const at = '2026-01-01T00:00:00.000Z'
    expect(backup.backupHasOtherLives(base)).toBe(false)
    expect(backup.backupHasOtherLives({ ...base, milestones: [{ id: 'a' }] })).toBe(false)
    expect(backup.backupHasOtherLives({ ...base, lifeRecords: [{ id: 'me' }] })).toBe(false)
    expect(backup.backupHasOtherLives({ ...base, milestones: [{ id: 'a', lifeOps: { mom: { op: 'add', at } } }] })).toBe(true)
    expect(backup.backupHasOtherLives({ ...base, chapters: [{ id: 'c', lifeId: 'mom' }] })).toBe(true)
    expect(backup.backupHasOtherLives({ ...base, relationships: [{ id: 'e' }] })).toBe(true)
  })

  it('still restores a backup that only has Me', async () => {
    const s = await setup()
    s.gate.recordWriter('old-phone', { schema: 1, app: '4.1.0', platform: 'android' }, Date.now() - DAY)
    await s.ms.addMilestone({ title: 'Mine', date: '2012-06-01' })
    const file = await s.backup.buildBackup()
    await expect(s.backup.restoreBackup(s.backup.readBackup(file))).resolves.toBeTruthy()
  })
})
