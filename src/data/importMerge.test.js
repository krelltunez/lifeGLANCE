import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}))

// Lives Phase 5b: Import and merge, and Share Lives. Source of truth:
// docs/lifeGLANCE-app-spec.md, "Decided before Phase 5b" and "Decided in Phase 5b".

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
const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-02-01T00:00:00.000Z'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAQID'

async function setup() {
  const db = await import('./db')
  const ms = await import('./milestones')
  const lives = await import('./lives')
  const rel = await import('./relationships')
  const backup = await import('./backup')
  const im = await import('./importMerge')
  const lm = await import('./lifeMembership')
  const gate = await import('../sync/lifeGate')
  const dirty = await import('../sync/dirty')
  const tomb = await import('../sync/tombstones')
  await db.initDB()
  const dirtied = []
  dirty.registerDirtyTarget({ markDirty: id => dirtied.push(id) })
  return { db, ms, lives, rel, backup, im, lm, gate, tomb, dirtied }
}

const ops = (o) => Object.fromEntries(Object.entries(o).map(([id, at]) => [id, { op: 'add', at }]))
const ms = (id, extra = {}) => ({ id, title: id, date: '2015-06-01T00:00:00.000Z', category: 'family', created_at: T1, updated_at: T1, ...extra })

// A sister's export: her Me (nickname Ann), Mom (same id as nothing here),
// a milestone of hers, one of Mom's, one shared, a chapter of Mom's, and the
// edge "Mom is Ann's parent".
const sisterFile = () => ({
  format: 2, milestones: [
    ms('ann-only'),
    ms('mom-only', { lifeOps: ops({ momX: T1 }) }),
    ms('shared', { lifeOps: ops({ me: T1, momX: T1 }), category: 'their-cat' }),
  ],
  photos: { 'mom-only': PNG },
  chapters: [{ id: 'ch1', title: 'Lisbon', start: T1, end: null, color: '#fff', lifeId: 'momX', milestoneIds: ['mom-only', 'gone'], updated_at: T1 }],
  categories: [{ id: 'family', label: 'family', color: '#111' }, { id: 'their-cat', label: 'theirs', color: '#222' }],
  birthday: '1992-02-02',
  lifeRecords: [
    { id: 'me', name: 'Me', nickname: 'Ann', birthDate: '1992-02-02', created_at: T1, updated_at: T1 },
    { id: 'momX', name: 'Mom', birthDate: '1960-03-04', notes: 'from Ann', created_at: T1, updated_at: T1 },
  ],
  relationships: [{ id: 'e1', fromLifeId: 'me', toLifeId: 'momX', type: 'parent', relationshipNote: '', created_at: T1, updated_at: T1 }],
  lifePhotos: { momX: PNG },
})

describe('suggesting what to do with each Life', () => {
  it('matches the same id, suggests name plus birth date, never name alone, and skips the exporter\'s Me', async () => {
    const s = await setup()
    const momHere = await s.lives.createLife({ name: 'mom ', birthDate: '1960-03-04' })
    const dadHere = await s.lives.createLife({ name: 'Dad' })
    const file = s.backup.readBackup({ ...sisterFile(), lifeRecords: [
      ...sisterFile().lifeRecords,
      { id: dadHere.id, name: 'Father' },                       // same id: matched whatever its name
      { id: 'dad2', name: 'Dad', birthDate: '1958-01-01' },      // same name, no birth date here: not suggested
    ] })
    const plan = s.im.planImport(file, await s.lives.loadLives())
    expect(plan.me).toEqual({ action: 'skip' })
    expect(plan.momX).toEqual({ action: 'match', targetId: momHere.id })
    expect(plan[dadHere.id]).toEqual({ action: 'match', targetId: dadHere.id })
    expect(plan.dad2).toEqual({ action: 'new', name: 'Dad' })
  })

  it('a file from before Lives holds only Me', async () => {
    const s = await setup()
    const lives = s.im.fileLives(s.backup.readBackup({ milestones: [], birthday: '1990-01-01' }))
    expect(lives).toEqual([{ id: 'me', name: 'Me', birthDate: '1990-01-01' }])
  })
})

describe('importing', () => {
  it('maps the file\'s Lives to the ones chosen, and leaves out what belongs only to skipped Lives', async () => {
    const s = await setup()
    const momHere = await s.lives.createLife({ name: 'Mom', birthDate: '1960-03-04' })
    const file = s.backup.readBackup(sisterFile())
    const decisions = { me: { action: 'skip' }, momX: { action: 'match', targetId: momHere.id } }
    const preview = await s.im.previewImport(file, decisions)
    expect(preview).toMatchObject({ milestonesAdded: 2, milestonesMerged: 0, milestonesLeftOut: 1, chaptersAdded: 1, relationshipsAdded: 0, livesAdded: 0 })
    expect((await s.db.dbGetAll()).length).toBe(0)   // the preview writes nothing
    const done = await s.im.applyImport(file, decisions)
    expect(done).toEqual(preview)
    const all = await s.db.dbGetAll()
    expect(all.map(m => m.id).sort()).toEqual(['mom-only', 'shared'])
    for (const m of all) expect(s.lm.lifeIdsOf(m)).toEqual([momHere.id])
    const [chapter] = await s.db.dbGetAllChapters()
    expect(chapter).toMatchObject({ lifeId: momHere.id, milestoneIds: ['mom-only'] })   // a member left out is dropped
  })

  it('adds the exporter\'s Me as a new Life with the name given, and remaps the relationships to it', async () => {
    const s = await setup()
    const file = s.backup.readBackup(sisterFile())
    await s.im.applyImport(file, { me: { action: 'new', name: 'Ann' }, momX: { action: 'new', name: 'Mom' } })
    const lives = await s.db.dbGetAllLives()
    const ann = lives.find(l => l.name === 'Ann')
    expect(ann.id).not.toBe('me')
    expect(ann.nickname).toBe('Ann')
    expect(lives.find(l => l.id === 'momX')).toMatchObject({ name: 'Mom', birthDate: '1960-03-04', photo_id: 'momX-photo' })
    const [edge] = await s.db.dbGetAllRelationships()
    expect(edge).toMatchObject({ fromLifeId: ann.id, toLifeId: 'momX', type: 'parent' })   // "Mom is Ann's parent"
    const shared = (await s.db.dbGetAll()).find(m => m.id === 'shared')
    expect(s.lm.lifeIdsOf(shared)).toEqual([ann.id, 'momX'].sort())
    expect((await s.db.dbGetAll()).find(m => m.id === 'ann-only').lifeOps).toEqual({ [ann.id]: { op: 'add', at: T1 } })
  })

  it('matched to my own Me, a milestone with no Lives stays a plain Me milestone', async () => {
    const s = await setup()
    const file = s.backup.readBackup(sisterFile())
    await s.im.applyImport(file, { me: { action: 'match', targetId: 'me' }, momX: { action: 'skip' } })
    const mine = (await s.db.dbGetAll()).find(m => m.id === 'ann-only')
    expect(mine.lifeOps).toBeUndefined()
  })

  it('merges a milestone both sides have, keeping both sides\' Lives and this device\'s photo', async () => {
    const s = await setup()
    const momHere = await s.lives.createLife({ name: 'Mom' })
    await s.db.dbPut(ms('shared', { title: 'Ours', updated_at: T2, has_photo: true, photo_id: 'shared-photo' }))
    const file = s.backup.readBackup(sisterFile())
    await s.im.applyImport(file, { me: { action: 'skip' }, momX: { action: 'match', targetId: momHere.id } })
    const m = (await s.db.dbGetAll()).find(x => x.id === 'shared')
    expect(m.title).toBe('Ours')                                  // newer local fields win
    expect(s.lm.lifeIdsOf(m)).toEqual(['me', momHere.id].sort())  // local Me kept, Mom added
    expect(m).toMatchObject({ has_photo: true, photo_id: 'shared-photo' })
  })

  it('a matched Life keeps its own fields; the file only fills empty ones', async () => {
    const s = await setup()
    const momHere = await s.lives.createLife({ name: 'Mother', notes: 'mine' })
    await s.im.applyImport(s.backup.readBackup(sisterFile()), { me: { action: 'skip' }, momX: { action: 'match', targetId: momHere.id } })
    const mom = await s.db.dbGetLife(momHere.id)
    expect(mom).toMatchObject({ name: 'Mother', notes: 'mine', birthDate: '1960-03-04', photo_id: `${momHere.id}-photo` })
  })

  it('drops an edge equal to one here, and never adds a Life\'s edge to itself', async () => {
    const s = await setup()
    const momHere = await s.lives.createLife({ name: 'Mom' })
    await s.rel.setRelationshipToMe(momHere.id, 'parent', [])
    const file = s.backup.readBackup(sisterFile())
    // The sister's Me matched to my Me: her "Mom is my parent" equals mine.
    const r = await s.im.applyImport(file, { me: { action: 'match', targetId: 'me' }, momX: { action: 'match', targetId: momHere.id } })
    expect(r.relationshipsAdded).toBe(0)
    expect(await s.db.dbGetAllRelationships()).toHaveLength(1)
    // Both matched to the same Life: the edge would join it to itself.
    const r2 = await s.im.applyImport(file, { me: { action: 'match', targetId: momHere.id }, momX: { action: 'match', targetId: momHere.id } })
    expect(r2.relationshipsAdded).toBe(0)
  })

  it('adds the categories the imported milestones use, and only those', async () => {
    const s = await setup()
    const { loadCategories } = await import('../utils/colors')
    const before = loadCategories().map(c => c.id)
    await s.im.applyImport(s.backup.readBackup(sisterFile()), { me: { action: 'new', name: 'Ann' }, momX: { action: 'new', name: 'Mom' } })
    const after = loadCategories().map(c => c.id)
    expect(after).toEqual([...before, 'their-cat'])
  })

  it('a milestone this device deleted comes back as a new write, so sync keeps it', async () => {
    const s = await setup()
    s.tomb.writeMilestoneTombstone('ann-only')
    await s.im.applyImport(s.backup.readBackup(sisterFile()), { me: { action: 'match', targetId: 'me' }, momX: { action: 'skip' } })
    // The file-tier merge, with the tombstone on both sides, keeps it.
    const { buildBackupPayload, mergePayloads } = await import('../sync/adapter.js')
    const local = await buildBackupPayload()
    const peer = { lives: { default: { milestones: [], milestoneTombstones: s.tomb.getMilestoneTombstones() } } }
    const { data } = mergePayloads(local, peer)
    expect(data.lives.default.milestones.map(m => m.id)).toContain('ann-only')
  })

  it('brings no one else\'s links, media or vault references, but brings the photo', async () => {
    const s = await setup()
    const file = sisterFile()
    file.milestones[1] = { ...file.milestones[1], dayglance_linked: true, dayglance_task_id: 't1', media_type: 'video', photo_id: 'a'.repeat(64), has_photo: true }
    await s.im.applyImport(s.backup.readBackup(file), { me: { action: 'skip' }, momX: { action: 'new', name: 'Mom' } })
    const m = (await s.db.dbGetAll()).find(x => x.id === 'mom-only')
    expect(m).toMatchObject({ dayglance_linked: false, dayglance_task_id: null, media_type: null, has_photo: true, photo_id: 'mom-only-photo' })
    expect(await s.db.dbGetPhoto('mom-only')).not.toBeNull()
  })

  it('marks everything it writes for sync', async () => {
    const s = await setup()
    await s.im.applyImport(s.backup.readBackup(sisterFile()), { me: { action: 'skip' }, momX: { action: 'new', name: 'Mom' } })
    for (const id of ['momX', 'mom-only', 'shared', 'ch1']) expect(s.dirtied).toContain(id)
  })

  it('is refused while an older device is active if it involves another Life, but not for Me alone', async () => {
    const s = await setup()
    s.gate.recordWriter('old-phone', { schema: 1, app: '4.1.0', platform: 'android' }, Date.now() - DAY)
    const file = s.backup.readBackup(sisterFile())
    await expect(s.im.applyImport(file, { me: { action: 'skip' }, momX: { action: 'new', name: 'Mom' } }))
      .rejects.toBeInstanceOf(s.gate.MultipleLivesBlockedError)
    expect(await s.db.dbGetAll()).toEqual([])
    await expect(s.im.applyImport(file, { me: { action: 'match', targetId: 'me' }, momX: { action: 'skip' } })).resolves.toBeTruthy()
  })
})

describe('Share Lives', () => {
  it('holds only the chosen Lives, with memberships trimmed to them', async () => {
    const s = await setup()
    localStorage.setItem('lifeglance-birthday', '1990-05-06')
    const mom = await s.lives.createLife({ name: 'Mom' })
    const dad = await s.lives.createLife({ name: 'Dad' })
    await s.ms.addMilestone({ title: 'Mine', date: '2012-06-01' })
    const shared = await s.ms.addMilestone({ title: 'Shared', date: '2012-06-01' })
    await s.lives.addLifeToMilestone(shared, mom.id)
    await s.ms.addMilestone({ title: 'Dad only', date: '2012-06-01', lifeOps: { [dad.id]: { op: 'add', at: T1 } } })
    await s.rel.setRelationshipToMe(mom.id, 'parent', [])
    await s.db.dbPutRelationship(s.rel.buildRelationship({ fromLifeId: mom.id, toLifeId: dad.id, type: 'partner' }))

    const file = await s.backup.buildBackup({ lifeIds: [mom.id] })
    expect(file.scope).toBe('shared')
    expect(file.lifeRecords.map(l => l.id)).toEqual([mom.id])
    expect(file.milestones.map(m => m.title)).toEqual(['Shared'])
    expect(Object.keys(file.milestones[0].lifeOps)).toEqual([mom.id])
    expect(file.relationships).toEqual([])   // both edges reach a Life left out
    expect(file.birthday).toBe('')           // Me's birthday travels only with Me
  })

  it('a shared file cannot be restored, only imported', async () => {
    const s = await setup()
    const mom = await s.lives.createLife({ name: 'Mom' })
    const file = s.backup.readBackup(JSON.parse(JSON.stringify(await s.backup.buildBackup({ lifeIds: [mom.id] }))))
    await expect(s.backup.restoreBackup(file)).rejects.toBeInstanceOf(s.backup.SharedFileRestoreError)
    expect(s.im.fileLives(file).map(l => l.id)).toEqual([mom.id])   // no Me row in the preview
  })
})
