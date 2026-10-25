import { describe, it, expect, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}))

import { runDirectAccessCycle } from './directAccessCycle.js'
import { mergePayloads } from './adapter.js'
import { LOCAL_EDIT_KEY } from './localEditStamp.js'
import { createICloudTransport, getICloudSyncPref } from './icloud.js'

// Zero-config iCloud between an iPhone and an iPad on one Apple ID: the real
// iCloud transport, the real cycle and merge, over one shared container.
// What it holds the wiring to: a device with data of its own syncs without
// being asked; a fresh install facing iCloud data is asked before anything is
// restored or written; the answer is kept, and "start fresh" leaves iCloud alone.

const empty = () => ({ lives: { default: { milestones: [], chapters: [], milestoneTombstones: {}, chapterTombstones: {}, birthday: '', birthdayUpdatedAt: '', categories: [], categoriesUpdatedAt: '' } } })
const milestone = (id, title, updated_at) => ({ id, title, date: '2020-01-01', category: 'personal', created_at: updated_at, updated_at })
const withMilestones = (milestones) => ({ lives: { default: { ...empty().lives.default, milestones } } })
const titles = (p) => p.lives.default.milestones.map((m) => m.title).sort()

const memStorage = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: (k) => { m.delete(k) } }
}

function container() {
  const files = new Map()
  const bridge = {
    available: async () => true,
    read: async (path) => (files.has(path) ? { kind: 'text', text: files.get(path) } : { kind: 'absent' }),
    write: async (path, text) => { files.set(path, text); return true },
    list: async () => [...files.keys()],
    remove: async (path) => files.delete(path),
    makeDir: async () => true,
    onChanged: () => () => {},
  }
  return { files, bridge }
}

const noCrypto = {
  isEncryptedEnvelope: () => false,
  decryptData: async () => { throw new Error('plaintext only') },
  encryptData: async () => { throw new Error('plaintext only') },
  encryptionReady: () => false,
}

function device(name, icloud, start) {
  const storage = memStorage()
  const transport = createICloudTransport({ bridge: () => icloud.bridge, storage: () => storage })
  let store = start
  let state = { missingSince: 0, lastWriteAt: 0 }
  let now = Date.parse('2026-10-25T12:00:00.000Z')
  return {
    storage, transport,
    get store() { return store },
    edit: (s) => { store = s; storage.setItem(LOCAL_EDIT_KEY, new Date(now).toISOString()) },
    tick: (ms) => { now += ms },
    // One pass of what useSnapshotFileSync does: inert while off, then the cycle.
    async sync() {
      if (!transport.isEnabled() || !(await transport.isAvailable())) return null
      const r = await runDirectAccessCycle({
        transport,
        buildPayload: async () => store,
        applyPayload: async (d) => { store = d },
        mergePayloads,
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

describe('zero-config iCloud between two devices', () => {
  it('a device with its own data syncs without being asked, and a second such device merges', async () => {
    const icloud = container()
    const phone = device('phone', icloud, withMilestones([milestone('a', 'Moved to Denver', '2026-10-24T09:00:00.000Z')]))
    expect(await phone.sync()).toMatchObject({ kind: 'seeded', wrote: true })
    expect(getICloudSyncPref(() => phone.storage)).toBeNull()   // never asked, still on

    const tablet = device('tablet', icloud, withMilestones([milestone('b', 'First marathon', '2026-10-24T09:30:00.000Z')]))
    expect(await tablet.sync()).toMatchObject({ kind: 'merged', applied: true })
    expect(titles(tablet.store)).toEqual(['First marathon', 'Moved to Denver'])
  })

  it('a fresh install facing iCloud data is asked first, and restoring brings it in', async () => {
    const icloud = container()
    const phone = device('phone', icloud, withMilestones([milestone('a', 'Moved to Denver', '2026-10-24T09:00:00.000Z')]))
    await phone.sync()
    const before = new Map(icloud.files)

    const tablet = device('tablet', icloud, empty())
    const asked = await tablet.sync()
    expect(asked).toMatchObject({ kind: 'prompted' })
    expect(asked.info.data.lives.default.milestones).toHaveLength(1)   // what the question counts
    expect(titles(tablet.store)).toEqual([])                          // nothing restored yet
    expect(icloud.files).toEqual(before)                              // and nothing written

    tablet.transport.setEnabled(true)                                 // "Restore from iCloud"
    expect(await tablet.sync()).toMatchObject({ kind: 'merged', applied: true })
    expect(titles(tablet.store)).toEqual(['Moved to Denver'])
  })

  it('starting fresh turns iCloud off on that device and leaves iCloud alone', async () => {
    const icloud = container()
    const phone = device('phone', icloud, withMilestones([milestone('a', 'Moved to Denver', '2026-10-24T09:00:00.000Z')]))
    await phone.sync()
    const before = new Map(icloud.files)

    const tablet = device('tablet', icloud, empty())
    expect(await tablet.sync()).toMatchObject({ kind: 'prompted' })
    tablet.transport.setEnabled(false)                                // "Start fresh on this device"
    tablet.edit(withMilestones([milestone('t', 'New job', '2026-10-25T12:00:00.000Z')]))
    expect(await tablet.sync()).toBeNull()
    expect(icloud.files).toEqual(before)
    expect(titles(tablet.store)).toEqual(['New job'])
  })

  it('an empty container and an empty device: nothing to ask about', async () => {
    const icloud = container()
    const phone = device('phone', icloud, empty())
    const r = await phone.sync()
    expect(r.kind).not.toBe('prompted')
    expect(getICloudSyncPref(() => phone.storage)).toBeNull()
  })

  it('an edit on one device reaches the other on its next poll', async () => {
    const icloud = container()
    const phone = device('phone', icloud, withMilestones([milestone('a', 'Moved to Denver', '2026-10-24T09:00:00.000Z')]))
    const tablet = device('tablet', icloud, withMilestones([milestone('b', 'First marathon', '2026-10-24T09:30:00.000Z')]))
    await phone.sync(); await tablet.sync()
    phone.tick(60_000)
    await phone.sync()

    tablet.tick(120_000)
    tablet.edit({ lives: { default: { ...tablet.store.lives.default, milestones: [...tablet.store.lives.default.milestones, milestone('c', 'Adopted a dog', '2026-10-25T12:02:00.000Z')] } } })
    expect(await tablet.sync()).toMatchObject({ wrote: true })
    phone.tick(180_000)
    await phone.sync()
    expect(titles(phone.store)).toEqual(['Adopted a dog', 'First marathon', 'Moved to Denver'])
  })
})
