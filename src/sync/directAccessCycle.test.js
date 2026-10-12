import { describe, it, expect, vi } from 'vitest'
import { RELAY_CONFIRM_MS, RELAY_STAGGER_MS } from '@glance-apps/sync'
import { runDirectAccessCycle, payloadHasData, LOCAL_MODIFIED_KEY, SNAPSHOT_DATA_VERSION } from './directAccessCycle.js'
import { mergePayloads } from './adapter.js'
import { LOCAL_EDIT_KEY } from './localEditStamp.js'

// The cycle and the merge are real; the folder, the store and the crypto are
// fakes. Each "device" has its own storage, store and key; the folder is one
// shared string, as a syncing tool keeps it.

const empty = () => ({ lives: { default: { milestones: [], chapters: [], milestoneTombstones: {}, chapterTombstones: {}, birthday: '', birthdayUpdatedAt: '', categories: [], categoriesUpdatedAt: '' } } })
const milestone = (id, title, updated_at) => ({ id, title, date: '2020-01-01', category: 'personal', created_at: updated_at, updated_at })
const withMilestones = (p, milestones) => ({ lives: { default: { ...p.lives.default, milestones } } })
const names = (p) => p.lives.default.milestones.map((m) => m.title)

const memStorage = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: (k) => { m.delete(k) } }
}

function folder() {
  let text = null
  const writes = []
  return {
    get text() { return text },
    set: (t) => { text = t },
    writes,
    transport: (id, encrypt = false) => ({
      id: `direct-access:${id}`,
      lastSyncedKey: 'lifeglance-direct-access-last-synced',
      writeThrottleMs: 0,
      allowsPlaintextReseed: false,
      firstRunDecided: () => true,
      encryptsWrites: () => encrypt,
      read: async () => text,
      write: async (t) => { text = t; writes.push(t); return true },
    }),
  }
}

function device(name, opts = {}) {
  const storage = memStorage()
  let store = empty()
  let keyHeld = opts.key ?? true
  const applied = []
  const applyPayload = vi.fn(async (data) => { await new Promise((r) => setTimeout(r, 0)); store = data; applied.push(data) })
  const crypto = {
    isEncryptedEnvelope: (v) => !!v && typeof v === 'object' && v.enc === 'fake',
    encryptData: async (p) => ({ v: 1, enc: 'fake', data: JSON.stringify(p) }),
    decryptData: async (e) => {
      if (!keyHeld) throw Object.assign(new Error('no key'), { code: 'PASSPHRASE_REQUIRED' })
      return JSON.parse(e.data)
    },
    encryptionReady: () => keyHeld,
  }
  let now = Date.parse('2026-10-11T12:00:00.000Z')
  return {
    name,
    storage,
    applied,
    applyPayload,
    get store() { return store },
    setStore: (s) => { store = s },
    edit: (s) => { store = s; storage.setItem(LOCAL_EDIT_KEY, new Date(now).toISOString()) },
    giveKey: () => { keyHeld = true },
    tick: (ms) => { now += ms },
    run: (transport, state = null) =>
      runDirectAccessCycle({
        transport,
        buildPayload: async () => store,
        applyPayload,
        mergePayloads,
        crypto,
        storage,
        lastLocalEditAt: () => storage.getItem(LOCAL_EDIT_KEY),
        deviceId: () => name,
        now: () => now,
        log: { warn: () => {}, error: () => {} },
      }, state),
  }
}

describe('payloadHasData', () => {
  it('counts milestones and chapters, not the birthday, categories or tombstones', () => {
    expect(payloadHasData(empty())).toBe(false)
    const p = empty()
    p.lives.default.birthday = '1990-01-01'
    p.lives.default.categories = [{ id: 'c', label: 'c', color: '#fff' }]
    p.lives.default.milestoneTombstones = { a: '2026-01-01T00:00:00.000Z' }
    expect(payloadHasData(p)).toBe(false)
    expect(payloadHasData(withMilestones(empty(), [milestone('a', 'x', 't')]))).toBe(true)
    const q = empty(); q.lives.default.chapters = [{ id: 'ch', title: 'School', updated_at: 't' }]
    expect(payloadHasData(q)).toBe(true)
    expect(payloadHasData(null)).toBe(false)
    expect(payloadHasData({ lives: {} })).toBe(false)
  })
})

describe('Direct Access cycle: two devices over one folder', () => {
  it('seeds from the first device, applies on the second, and converges an edit made there', async () => {
    const f = folder()
    const a = device('a'); const b = device('b')
    a.edit(withMilestones(empty(), [milestone('x', 'Moved to Denver', '2026-10-11T11:00:00.000Z')]))

    const s1 = await a.run(f.transport('a'))
    expect(s1.outcome).toMatchObject({ kind: 'seeded', wrote: true })
    const header = JSON.parse(f.text)
    expect(header).toMatchObject({ version: SNAPSHOT_DATA_VERSION, writtenBy: 'a' })
    expect(header.data.lives.default.milestones).toHaveLength(1)
    expect(header.lastModified).toBeTruthy()

    const r1 = await b.run(f.transport('b'))
    expect(r1.outcome).toMatchObject({ kind: 'merged', applied: true, wrote: false })
    // The apply is async and awaited: by the time the cycle answers, the store holds it.
    expect(names(b.store)).toEqual(['Moved to Denver'])
    expect(b.storage.getItem(LOCAL_MODIFIED_KEY)).toBeTruthy()
    expect(b.storage.getItem('lifeglance-direct-access-last-synced')).toBeTruthy()

    // An edit made on B goes out at once (its local-edit stamp is newer than its last write).
    b.tick(1000)
    b.edit(withMilestones(b.store, [...b.store.lives.default.milestones, milestone('y', 'First job', '2026-10-11T12:00:01.000Z')]))
    const r2 = await b.run(f.transport('b'), r1.state)
    expect(r2.outcome).toMatchObject({ kind: 'merged', wrote: true, deferred: false })
    expect(JSON.parse(f.text).writtenBy).toBe('b')

    const s2 = await a.run(f.transport('a'), s1.state)
    expect(s2.outcome).toMatchObject({ kind: 'merged', applied: true })
    expect(names(a.store).sort()).toEqual(['First job', 'Moved to Denver'])
  })

  it('a change that reached a device by another road is relayed only after the file sat unchanged for the relay wait', async () => {
    const f = folder()
    const a = device('a')
    a.edit(withMilestones(empty(), [milestone('x', 'Moved to Denver', '2026-10-11T11:00:00.000Z')]))
    const s0 = await a.run(f.transport('a'))
    // Two quiet polls: the first real read stamps last-synced, the next one
    // takes that as the device's last write, and the edit above is older.
    a.tick(1000)
    const s0b = await a.run(f.transport('a'), s0.state)
    a.tick(1000)
    const s1 = await a.run(f.transport('a'), s0b.state)
    expect(s1.outcome).toMatchObject({ kind: 'merged', wrote: false })
    // The vault delivers a change to A's store; A's local-edit stamp does not move.
    a.tick(5000)
    a.setStore(withMilestones(a.store, [milestone('x', 'Moved to Boulder', '2026-10-11T12:00:04.000Z')]))
    const s2 = await a.run(f.transport('a'), s1.state)
    expect(s2.outcome).toMatchObject({ kind: 'merged', wrote: false, deferred: true, ownEdits: false })
    a.tick(RELAY_CONFIRM_MS - 1000)
    const s3 = await a.run(f.transport('a'), s2.state)
    expect(s3.outcome).toMatchObject({ wrote: false, deferred: true })
    a.tick(2000)
    const s4 = await a.run(f.transport('a'), s3.state)
    expect(s4.outcome).toMatchObject({ wrote: true, deferred: false })
    expect(JSON.parse(f.text).data.lives.default.milestones[0].title).toBe('Moved to Boulder')
  })

  it('relays are staggered by writer rank: a device that has seen a writer sorting before it waits longer', async () => {
    const f = folder()
    const a = device('a'); const b = device('b')
    a.edit(withMilestones(empty(), [milestone('x', 'Moved to Denver', '2026-10-11T11:00:00.000Z')]))
    await a.run(f.transport('a'))
    const r1 = await b.run(f.transport('b'))   // B has now seen writer "a"
    b.tick(5000)
    b.setStore(withMilestones(b.store, [milestone('x', 'Moved to Boulder', '2026-10-11T12:00:04.000Z')]))
    const r2 = await b.run(f.transport('b'), r1.state)
    expect(r2.outcome).toMatchObject({ deferred: true })
    b.tick(RELAY_CONFIRM_MS + 1000)
    const r3 = await b.run(f.transport('b'), r2.state)
    expect(r3.outcome).toMatchObject({ wrote: false, deferred: true })
    b.tick(RELAY_STAGGER_MS)
    const r4 = await b.run(f.transport('b'), r3.state)
    expect(r4.outcome).toMatchObject({ wrote: true })
  })

  it('the envelope rules: the switch decides the first write, the file decides after, and a device without the key is held', async () => {
    const f = folder()
    const a = device('a'); const b = device('b', { key: false })
    a.edit(withMilestones(empty(), [milestone('x', 'Moved to Denver', '2026-10-11T11:00:00.000Z')]))
    const s1 = await a.run(f.transport('a', true))
    expect(s1.outcome).toMatchObject({ kind: 'seeded', wrote: true })
    expect(JSON.parse(f.text)).toMatchObject({ enc: 'fake' })

    // B has no key: nothing applied, nothing written over the envelope, and the caller is told a key is needed.
    const r1 = await b.run(f.transport('b'))
    expect(r1.outcome).toEqual({ kind: 'skipped', reason: 'encrypted-unreadable', needsKey: true })
    expect(b.applyPayload).not.toHaveBeenCalled()
    expect(f.writes).toHaveLength(1)

    b.giveKey()
    const r2 = await b.run(f.transport('b'), r1.state)
    expect(r2.outcome).toMatchObject({ kind: 'merged', applied: true })
    expect(names(b.store)).toEqual(['Moved to Denver'])

    // B's own edit goes back as an envelope although B's switch is off: the file decides.
    b.tick(1000)
    b.edit(withMilestones(b.store, [...b.store.lives.default.milestones, milestone('y', 'First job', '2026-10-11T12:00:01.000Z')]))
    const r3 = await b.run(f.transport('b', false), r2.state)
    expect(r3.outcome).toMatchObject({ wrote: true })
    expect(JSON.parse(f.text)).toMatchObject({ enc: 'fake' })
    await a.run(f.transport('a', true), s1.state)
    expect(names(a.store)).toHaveLength(2)
  })

  it('a deletion travels as a tombstone and the milestone stays gone on the device that still held it', async () => {
    const f = folder()
    const a = device('a'); const b = device('b')
    a.edit(withMilestones(empty(), [milestone('x', 'Moved to Denver', '2026-10-11T11:00:00.000Z'), milestone('y', 'First job', '2026-10-11T11:00:00.000Z')]))
    const s1 = await a.run(f.transport('a'))
    const r1 = await b.run(f.transport('b'))
    expect(names(b.store)).toHaveLength(2)
    // A deletes one.
    a.tick(1000)
    const deleted = { lives: { default: { ...a.store.lives.default, milestones: a.store.lives.default.milestones.filter((m) => m.id !== 'y'), milestoneTombstones: { y: '2026-10-11T12:00:01.000Z' } } } }
    a.edit(deleted)
    const s2 = await a.run(f.transport('a'), s1.state)
    expect(s2.outcome).toMatchObject({ wrote: true })
    const r2 = await b.run(f.transport('b'), r1.state)
    expect(r2.outcome).toMatchObject({ applied: true })
    expect(names(b.store)).toEqual(['Moved to Denver'])
    expect(b.store.lives.default.milestoneTombstones).toHaveProperty('y')
  })

  it('an unavailable folder is an error outcome, never a merge', async () => {
    const f = folder()
    f.set(JSON.stringify({ error: 'grant revoked' }))
    const a = device('a')
    const r = await a.run(f.transport('a'))
    expect(r.outcome).toEqual({ kind: 'error', reason: 'unavailable', error: 'grant revoked' })
    expect(a.applyPayload).not.toHaveBeenCalled()
    expect(f.writes).toHaveLength(0)
  })
})
