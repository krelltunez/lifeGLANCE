import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}))

import {
  SYNC_SCHEMA, WRITER_WINDOW_DAYS, rowStamp, readRowStamp, ownWriterEntry, mergeWriters,
  noteWriter, readNewerWriter,
} from './writerStamp.js'
import { makeDbAdapter, bundleEntityId } from './dbAdapter.js'
import { mergePayloads } from './adapter.js'
import { runDirectAccessCycle } from './directAccessCycle.js'
import { createICloudTransport } from './icloud.js'
import { LOCAL_EDIT_KEY } from './localEditStamp.js'

// Lives Phase 1: this build must keep, untouched, everything a newer build
// (Lives v5.0) writes, and say on every write which build made it. These tests
// stand in for v5.0 with data shaped the way the spec says v5.0 will write it:
// Life membership inside the records, Life records and relationship edges as
// new row kinds (vault) and new arrays under lives.default (file).

const memStorage = () => {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    clear: () => m.clear(),
  }
}

beforeEach(() => { globalThis.localStorage = memStorage() })

const DAY = 24 * 60 * 60 * 1000
// A build newer than this one, whatever this one is.
const NEWER = SYNC_SCHEMA + 1
const NOW = Date.parse('2026-11-10T12:00:00.000Z')

// ── The stamp itself ────────────────────────────────────────────────────────

describe('row stamp', () => {
  it('says which device and build wrote the row', () => {
    expect(rowStamp('dev-1')).toEqual({ set: 'default', schema: SYNC_SCHEMA, device: 'dev-1', app: expect.any(String), platform: 'web' })
  })

  it("reads the plain 'default' a 4.0.x client writes as no stamp", () => {
    expect(readRowStamp('default')).toBeNull()
    expect(readRowStamp(undefined)).toBeNull()
    expect(readRowStamp({ set: 'default' })).toBeNull()
    expect(readRowStamp(rowStamp('d'))).toMatchObject({ schema: SYNC_SCHEMA })
  })
})

describe('writers map', () => {
  const day = (offset) => new Date(NOW + offset * DAY).toISOString().slice(0, 10)
  const entry = (offset, extra = {}) => ({ schema: 1, app: '4.1.0', platform: 'ios', day: day(offset), ...extra })

  it('keeps every device, with its latest day', () => {
    const a = { phone: entry(-3), mac: entry(-1) }
    const b = { phone: entry(-1), tablet: entry(-2) }
    expect(mergeWriters(a, b, NOW)).toEqual({ mac: entry(-1), phone: entry(-1), tablet: entry(-2) })
  })

  it('agrees with itself whichever side is local, on a same-day tie too', () => {
    const a = { phone: entry(0, { app: '4.1.0' }) }
    const b = { phone: entry(0, { app: '4.1.1' }) }
    expect(mergeWriters(a, b, NOW)).toEqual(mergeWriters(b, a, NOW))
  })

  it(`drops devices not seen for ${WRITER_WINDOW_DAYS} days`, () => {
    const a = { old: entry(-(WRITER_WINDOW_DAYS + 1)), edge: entry(-WRITER_WINDOW_DAYS), recent: entry(-1) }
    expect(Object.keys(mergeWriters(a, {}, NOW))).toEqual(['edge', 'recent'])
  })

  it('changes at most once a day for a device', () => {
    expect(ownWriterEntry(NOW)).toEqual(ownWriterEntry(NOW + 60_000))
    expect(ownWriterEntry(NOW).day).not.toBe(ownWriterEntry(NOW + DAY).day)
  })
})

describe('newer-version record', () => {
  it('ignores this schema and older, keeps a newer one, and expires it', () => {
    noteWriter({ schema: SYNC_SCHEMA }, NOW)
    expect(readNewerWriter(NOW)).toBeNull()

    noteWriter({ schema: SYNC_SCHEMA + 1, app: '5.0.0', platform: 'android' }, NOW)
    expect(readNewerWriter(NOW)).toMatchObject({ schema: SYNC_SCHEMA + 1, app: '5.0.0', platform: 'android' })
    expect(readNewerWriter(NOW + (WRITER_WINDOW_DAYS + 1) * DAY)).toBeNull()
  })

  it('tells the UI once, and again only after the record has expired', () => {
    const events = []
    globalThis.window = { dispatchEvent: (e) => events.push(e.type) }
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail } }
    try {
      noteWriter({ schema: NEWER }, NOW)
      noteWriter({ schema: NEWER }, NOW + DAY)
      expect(events).toEqual(['lifeglance:newer-writer'])
      noteWriter({ schema: NEWER }, NOW + (WRITER_WINDOW_DAYS + 2) * DAY)
      expect(events).toHaveLength(2)
    } finally {
      delete globalThis.window
      delete globalThis.CustomEvent
    }
  })
})

// ── GLANCEvault rows ────────────────────────────────────────────────────────

function memStore() {
  const ms = new Map(), cs = new Map()
  const bundles = {
    categories: { value: [], updatedAt: '' }, birthday: { value: '', updatedAt: '' },
    milestoneTombstones: { value: {} }, chapterTombstones: { value: {} },
  }
  const coll = (m) => ({ get: (id) => m.get(id) ?? null, put: (x) => m.set(x.id, x), delete: (id) => m.delete(id), all: () => [...m.values()] })
  return { ms, cs, milestones: coll(ms), chapters: coll(cs), getBundle: (k) => bundles[k], putBundle: (k, r) => { bundles[k] = r } }
}

// What a 4.0.x client pushes after applying a row: everything but _kind and
// life_id is kept in its store, and every push says life_id: 'default'.
const asPushedBy40x = (env) => {
  const { _kind, life_id, ...rest } = env // eslint-disable-line no-unused-vars
  return { ...rest, _kind, life_id: 'default' }
}

const chapterRow = (extra = {}) => ({
  id: 'c1', title: 'University', start: '2010-09-01', end: '2014-06-01', color: '#4A90D9',
  category: 'education', description: '', defaultMemberVisibility: 'shown', parentChapterId: null,
  milestoneIds: [], memberOps: {}, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  ...extra,
})

describe('vault rows', () => {
  it('stamps every row it pushes: milestones, chapters and bundles', async () => {
    const store = memStore()
    store.ms.set('m1', { id: 'm1', title: 'x', updated_at: '2026-01-01T00:00:00.000Z' })
    store.cs.set('c1', chapterRow())
    const a = makeDbAdapter({ store, deviceId: 'dev-1' })
    for (const id of ['m1', 'c1', bundleEntityId('categories')]) {
      const env = await a.getLocalEntity(id)
      expect(readRowStamp(env.life_id)).toMatchObject({ schema: SYNC_SCHEMA, device: 'dev-1' })
    }
  })

  it("never lets a stored record's own _kind or life_id override the stamp", async () => {
    const store = memStore()
    store.ms.set('m1', { id: 'm1', title: 'x', _kind: 'chapter', life_id: { schema: 2, device: 'v5' } })
    const env = await makeDbAdapter({ store, deviceId: 'dev-1' }).getLocalEntity('m1')
    expect(env._kind).toBe('milestone')
    expect(env.life_id.device).toBe('dev-1')
  })

  it('ignores a row kind it does not know, without throwing or storing it', async () => {
    const store = memStore()
    const a = makeDbAdapter({ store, deviceId: 'dev-1' })
    // 'life' became a known kind in v5.0; these stand for whatever comes next.
    const futureRow = { _kind: 'someFutureKind', life_id: { set: 'default', schema: NEWER }, id: 'L1', name: 'x' }
    await expect(a.applyRemoteEntity('L1', futureRow)).resolves.toBeUndefined()
    await expect(a.applyRemoteEntity('R1', { _kind: 'relationship', life_id: 'default' })).resolves.toBeUndefined()
    await expect(a.applyRemoteEntity('life:default:someFutureBundle', { _kind: 'someFutureBundle', value: {} })).resolves.toBeUndefined()
    expect(store.ms.size + store.cs.size).toBe(0)
    expect(await a.getLocalEntity('L1')).toBeNull()   // so it is never pushed back
  })

  it('keeps fields it does not know on milestones and chapters, and pushes them back', async () => {
    const store = memStore()
    const a = makeDbAdapter({ store, deviceId: 'dev-1' })
    const lifeOps = { L1: { op: 'add', at: '2026-11-01T00:00:00.000Z' } }
    await a.applyRemoteEntity('m1', { _kind: 'milestone', life_id: { set: 'default', schema: 2 }, id: 'm1', title: 'Wedding', updated_at: '2026-11-01T00:00:00.000Z', lifeOps })
    await a.applyRemoteEntity('c1', { _kind: 'chapter', life_id: { set: 'default', schema: 2 }, ...chapterRow({ lifeId: 'L1' }) })
    expect((await a.getLocalEntity('m1')).lifeOps).toEqual(lifeOps)
    expect((await a.getLocalEntity('c1')).lifeId).toBe('L1')
  })

  it("does not re-push a chapter just because the peer's stamp differs", async () => {
    const store = memStore()
    store.cs.set('c1', chapterRow())
    const dirty = []
    const a = makeDbAdapter({ store, deviceId: 'dev-1', markDirty: (id) => dirty.push(id) })
    // Same content, pushed by another Phase 1 device and by a 4.0.x echo.
    await a.applyRemoteEntity('c1', { _kind: 'chapter', life_id: rowStamp('dev-2'), ...chapterRow() })
    await a.applyRemoteEntity('c1', asPushedBy40x({ _kind: 'chapter', life_id: rowStamp('dev-2'), ...chapterRow() }))
    expect(dirty).toEqual([])
  })

  it('a 4.0.x echo of a stamped row carries no stamp, so an old writer stays visible', async () => {
    const store = memStore()
    store.ms.set('m1', { id: 'm1', title: 'x', updated_at: '2026-01-01T00:00:00.000Z' })
    const pushed = await makeDbAdapter({ store, deviceId: 'dev-1' }).getLocalEntity('m1')
    expect(readRowStamp(asPushedBy40x(pushed).life_id)).toBeNull()
  })

  it('notes a row from a newer build, and not one from this build or a 4.0.x client', async () => {
    const a = makeDbAdapter({ store: memStore(), deviceId: 'dev-1' })
    await a.applyRemoteEntity('m1', { _kind: 'milestone', life_id: rowStamp('dev-2'), id: 'm1', title: 'a' })
    await a.applyRemoteEntity('m2', { _kind: 'milestone', life_id: 'default', id: 'm2', title: 'b' })
    expect(readNewerWriter()).toBeNull()
    await a.applyRemoteEntity('m3', { _kind: 'milestone', life_id: { set: 'default', schema: NEWER, app: '9.0.0', platform: 'ios' }, id: 'm3', title: 'c' })
    expect(readNewerWriter()).toMatchObject({ schema: NEWER, app: '9.0.0' })
  })
})

// ── File tier ───────────────────────────────────────────────────────────────

const KNOWN_LIFE = ['milestones', 'chapters', 'milestoneTombstones', 'chapterTombstones', 'birthday', 'birthdayUpdatedAt', 'categories', 'categoriesUpdatedAt']
const emptyLife = () => ({ milestones: [], chapters: [], milestoneTombstones: {}, chapterTombstones: {}, birthday: '', birthdayUpdatedAt: '', categories: [], categoriesUpdatedAt: '' })
const ms = (id, title, updated_at, extra = {}) => ({ id, title, date: '2020-01-01', category: 'personal', created_at: updated_at, updated_at, ...extra })

// A file as v5.0 would write it.
const v5File = () => ({
  writers: { v5phone: { schema: NEWER, app: '9.0.0', platform: 'ios', day: '2026-11-09' } },
  futureTopLevel: { anything: true },
  lives: {
    someOtherSlot: { note: 'never written by v5.0 either, but must survive' },
    default: {
      ...emptyLife(),
      milestones: [ms('w', 'Wedding', '2026-11-01T00:00:00.000Z', { lifeOps: { L1: { op: 'add', at: '2026-11-01T00:00:00.000Z' } } })],
      lifeRecords: [{ id: 'L1', name: 'Mom', birthDate: '1960-03-04', updated_at: '2026-11-01T00:00:00.000Z' }],
      lifeTombstones: {},
      relationships: [{ id: 'E1', fromLifeId: 'me', toLifeId: 'L1', type: 'parent' }],
    },
  },
})

describe('file-tier merge', () => {
  it('passes through every key it does not know, at every level', () => {
    const local = { writers: { p1: ownWriterEntry() }, lives: { default: emptyLife() } }
    const { data } = mergePayloads(local, v5File())
    expect(data.futureTopLevel).toEqual({ anything: true })
    expect(data.lives.someOtherSlot).toEqual(v5File().lives.someOtherSlot)
    for (const k of ['lifeRecords', 'lifeTombstones', 'relationships']) expect(data.lives.default[k]).toEqual(v5File().lives.default[k])
    expect(data.lives.default.milestones[0].lifeOps).toEqual(v5File().lives.default.milestones[0].lifeOps)
  })

  it("does not count unknown keys as a change on either side", () => {
    const remote = v5File()
    // This build knows lifeRecords and lifeTombstones (v5.0), so only keys
    // still unknown to it (relationships, futureTopLevel) are passed through.
    const knownHere = [...KNOWN_LIFE, 'lifeRecords', 'lifeTombstones']
    const local = { writers: remote.writers, lives: { default: { ...remote.lives.default } } }
    for (const k of Object.keys(local.lives.default)) if (!knownHere.includes(k)) delete local.lives.default[k]
    const r = mergePayloads(local, remote)
    expect(r.localChanged).toBe(false)
    expect(r.remoteChanged).toBe(false)
  })

  it('adds its own writer entry once, then stops asking to write', () => {
    const local = { writers: { p1: ownWriterEntry() }, lives: { default: emptyLife() } }
    const first = mergePayloads(local, v5File())
    expect(first.remoteChanged).toBe(true)
    expect(Object.keys(first.data.writers)).toEqual(['p1', 'v5phone'])
    const second = mergePayloads(local, first.data)
    expect(second.remoteChanged).toBe(false)
  })

  it('notes a newer build that wrote the file', () => {
    mergePayloads({ lives: { default: emptyLife() } }, v5File())
    expect(readNewerWriter()).toMatchObject({ schema: NEWER, app: '9.0.0' })
  })
})

// ── Whole cycles over a shared folder ───────────────────────────────────────

function folder() {
  const files = new Map()
  return {
    files,
    bridge: {
      available: async () => true,
      read: async (p) => (files.has(p) ? { kind: 'text', text: files.get(p) } : { kind: 'absent' }),
      write: async (p, text) => { files.set(p, text); return true },
      list: async () => [...files.keys()],
      remove: async (p) => files.delete(p),
      makeDir: async () => true,
      onChanged: () => () => {},
    },
  }
}
const noCrypto = { isEncryptedEnvelope: () => false, decryptData: async () => { throw new Error('x') }, encryptData: async () => { throw new Error('x') }, encryptionReady: () => false }
const fileData = (f) => {
  const text = [...f.files.values()][0]
  return JSON.parse(text).data
}

// kind: 'phase1' keeps only what it knows (like makeApplyPayload) and stamps
// its payload; '40x' merges the way 4.0.x did (known keys only, no writers);
// 'v5' keeps everything (enough to stand in for a v5.0 writer).
function device(name, kind, f, life) {
  const storage = memStorage()
  const transport = createICloudTransport({ bridge: () => f.bridge, storage: () => storage })
  transport.setEnabled(true)
  let store = { lives: { default: life } }
  if (kind === 'v5') store = { ...v5File(), lives: { ...v5File().lives, default: { ...v5File().lives.default, ...life } } }
  let state = { missingSince: 0, lastWriteAt: 0 }
  let now = NOW
  const knownOnly = (d) => ({ lives: { default: Object.fromEntries(KNOWN_LIFE.map(k => [k, d.lives.default[k]])) } })
  const merge = kind === '40x'
    ? (l, r) => { const x = mergePayloads(l, r); return { ...x, data: knownOnly(x.data) } }
    : mergePayloads
  return {
    get store() { return store },
    edit(fn) { now += 1000; store = fn(store); storage.setItem(LOCAL_EDIT_KEY, new Date(now).toISOString()) },
    async sync() {
      now += 60_000
      const r = await runDirectAccessCycle({
        transport,
        buildPayload: async () => (kind === 'phase1' ? { writers: { [name]: ownWriterEntry(now) }, ...knownOnly(store) } : store),
        applyPayload: async (d) => { store = kind === 'v5' ? d : knownOnly(d) },
        mergePayloads: merge,
        crypto: noCrypto,
        storage,
        lastLocalEditAt: () => storage.getItem(LOCAL_EDIT_KEY),
        deviceId: () => name,
        now: () => now,
        log: { warn: () => {}, error: () => {} },
      }, state)
      state = r.state
      return r.outcome
    },
  }
}

describe('a Phase 1 device sharing a folder with v5.0', () => {
  it("keeps v5.0's Lives data through its own edits, round after round", async () => {
    const f = folder()
    const v5 = device('v5phone', 'v5', f, {})
    await v5.sync()

    const p1 = device('p1', 'phase1', f, emptyLife())
    await p1.sync()
    for (let i = 0; i < 3; i++) {
      p1.edit((s) => ({ lives: { default: { ...s.lives.default, milestones: [...s.lives.default.milestones, ms(`p${i}`, `Edit ${i}`, new Date(NOW + i * DAY).toISOString())] } } }))
      await p1.sync()
    }

    const data = fileData(f)
    expect(data.lives.default.milestones.map(m => m.title).sort()).toEqual(['Edit 0', 'Edit 1', 'Edit 2', 'Wedding'])
    for (const k of ['lifeRecords', 'lifeTombstones', 'relationships']) expect(data.lives.default[k]).toEqual(v5File().lives.default[k])
    expect(data.lives.default.milestones.find(m => m.id === 'w').lifeOps).toBeTruthy()
    expect(data.futureTopLevel).toEqual({ anything: true })
    expect(Object.keys(data.writers).sort()).toEqual(['p1', 'v5phone'])
    expect(readNewerWriter()).toMatchObject({ schema: NEWER })
    // and nothing of it lands in the Phase 1 device's own store
    expect(Object.keys(p1.store.lives.default).sort()).toEqual([...KNOWN_LIFE].sort())
  })

  it("a 4.0.x write strips the writers map, which is how v5.0 will spot an old device", async () => {
    const f = folder()
    const p1 = device('p1', 'phase1', f, { ...emptyLife(), milestones: [ms('a', 'A', '2026-11-01T00:00:00.000Z')] })
    await p1.sync()
    expect(fileData(f).writers).toHaveProperty('p1')

    const old = device('old', '40x', f, emptyLife())
    await old.sync()
    old.edit((s) => ({ lives: { default: { ...s.lives.default, milestones: [...s.lives.default.milestones, ms('b', 'B', '2026-11-10T13:00:00.000Z')] } } }))
    await old.sync()
    expect(fileData(f).writers).toBeUndefined()

    // The Phase 1 device puts its own entry back on its next write.
    p1.edit((s) => s)
    await p1.sync()
    expect(fileData(f).writers).toHaveProperty('p1')
    expect(fileData(f).lives.default.milestones.map(m => m.title).sort()).toEqual(['A', 'B'])
  })
})
