import { afterEach, describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}))

import { runDirectAccessCycle } from './directAccessCycle.js'
import { mergePayloads } from './adapter.js'
import { LOCAL_EDIT_KEY } from './localEditStamp.js'
import { createICloudTransport, ICLOUD_FIRST_SYNC_GRACE_MS, ICLOUD_SYNC_FILE } from './icloud.js'
import { createICloudBridge, desktopICloudPlugin } from '../native/icloud.js'
import { createICloudStore } from '../../electron/icloud.js'

// The desktop app on a Mac (docs/desktop-app.md, "iCloud Drive on macOS"): the
// real transport, cycle and merge of icloudSync.scenarios.test.js, but over
// the main process's store (electron/icloud.js) writing real files in a temp
// ~/Library/Mobile Documents, through the same adapter and bridge the app
// builds on a Mac. An iPhone here is a second bridge over the same folder for
// which a missing file is missing, as Apple's API tells it.
//
// What it holds: the Mac and the iPhone merge through the files; a Mac's first
// launch writes nothing while iCloud has not listed the iPhone's file yet, and
// asks before restoring once it has.

const empty = () => ({ lives: { default: { milestones: [], chapters: [], milestoneTombstones: {}, chapterTombstones: {}, birthday: '', birthdayUpdatedAt: '', categories: [], categoriesUpdatedAt: '' } } })
const milestone = (id, title, updated_at) => ({ id, title, date: '2020-01-01', category: 'personal', created_at: updated_at, updated_at })
const withMilestones = (milestones) => ({ lives: { default: { ...empty().lives.default, milestones } } })
const titles = (p) => p.lives.default.milestones.map((m) => m.title).sort()

const memStorage = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: (k) => { m.delete(k) } }
}

const noCrypto = {
  isEncryptedEnvelope: () => false,
  decryptData: async () => { throw new Error('plaintext only') },
  encryptData: async () => { throw new Error('plaintext only') },
  encryptionReady: () => false,
}

const homes = []
afterEach(() => { for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true }) })

/** A Mac's iCloud Drive: the own container's folder on disk, and the two views of it. */
function iCloudDrive() {
  const home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'lifeglance-icloud-scenario-'))
  homes.push(home)
  const docs = nodePath.join(home, 'Library', 'Mobile Documents', 'iCloud~com~lifeglance', 'Documents')
  fs.mkdirSync(docs, { recursive: true })
  const store = createICloudStore({ home })
  // The preload's icloud group, minus the IPC hop (electron/preload.cjs, main.js).
  const desktop = {
    available: async () => store.available(),
    readFile: async (o) => store.readFile(o.path, o.container),
    writeFile: async (o) => store.writeFile(o.path, o.text, o.container),
    listFiles: async (o) => store.listFiles(o.path, o.container),
    deleteFile: async (o) => store.deleteFile(o.path, o.container),
    makeDir: async (o) => store.makeDir(o.path, o.container),
    onChanged: () => () => {},
  }
  return {
    docs,
    file: nodePath.join(docs, ICLOUD_SYNC_FILE),
    names: () => fs.readdirSync(docs).sort(),
    macBridge: createICloudBridge(desktopICloudPlugin(desktop), { absentMayBePending: true }),
    phoneBridge: createICloudBridge(desktopICloudPlugin(desktop)),
  }
}

function device(name, bridge, start) {
  const storage = memStorage()
  let now = Date.parse('2026-11-15T12:00:00.000Z')
  const transport = createICloudTransport({ bridge: () => bridge, storage: () => storage, now: () => now, log: { warn: () => {} } })
  let store = start
  let state = { missingSince: 0, lastWriteAt: 0 }
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

describe('a Mac and an iPhone on one Apple ID, over real files', () => {
  it('a Mac with its own timeline merges with the iPhone\'s, both ways', async () => {
    const drive = iCloudDrive()
    const phone = device('phone', drive.phoneBridge, withMilestones([milestone('a', 'Moved to Denver', '2026-11-14T09:00:00.000Z')]))
    expect(await phone.sync()).toMatchObject({ kind: 'seeded', wrote: true })

    // Made on this Mac (the edit stamp says so), so the merge is written at once.
    const mac = device('mac', drive.macBridge, empty())
    mac.edit(withMilestones([milestone('b', 'First marathon', '2026-11-14T09:30:00.000Z')]))
    expect(await mac.sync()).toMatchObject({ kind: 'merged', applied: true, wrote: true })
    expect(titles(mac.store)).toEqual(['First marathon', 'Moved to Denver'])
    expect(drive.names()).toEqual([ICLOUD_SYNC_FILE])          // one file, no temp or conflict copy beside it

    phone.tick(60_000)
    expect(await phone.sync()).toMatchObject({ kind: 'merged', applied: true })
    expect(titles(phone.store)).toEqual(['First marathon', 'Moved to Denver'])
  })

  it('an edit on the Mac reaches the iPhone, written in place', async () => {
    const drive = iCloudDrive()
    const phone = device('phone', drive.phoneBridge, withMilestones([milestone('a', 'Moved to Denver', '2026-11-14T09:00:00.000Z')]))
    const mac = device('mac', drive.macBridge, withMilestones([milestone('b', 'First marathon', '2026-11-14T09:30:00.000Z')]))
    await phone.sync(); await mac.sync()
    const inode = fs.statSync(drive.file).ino

    mac.tick(120_000)
    mac.edit({ lives: { default: { ...mac.store.lives.default, milestones: [...mac.store.lives.default.milestones, milestone('c', 'Adopted a dog', '2026-11-15T12:02:00.000Z')] } } })
    expect(await mac.sync()).toMatchObject({ wrote: true })
    // The same inode: a rename would drop what makes iCloud upload the file.
    expect(fs.statSync(drive.file).ino).toBe(inode)

    phone.tick(180_000)
    await phone.sync()
    expect(titles(phone.store)).toEqual(['Adopted a dog', 'First marathon', 'Moved to Denver'])
  })
})

// A Mac's first launch. The iCloud Drive folder exists, but iCloud has not
// listed the iPhone's file on this Mac yet, so it looks empty. Seeding then is
// how lastGLANCE's first Mac launch (2026-11-09) wrote its own file under the
// name, and iCloud kept the iPhone's as a "… 2.json" conflict copy.
describe('a Mac\'s first launch, over real files', () => {
  it('writes nothing while the folder looks empty, then asks once the file arrives', async () => {
    const drive = iCloudDrive()
    const mac = device('mac', drive.macBridge, empty())
    expect(await mac.sync()).toMatchObject({ kind: 'skipped', reason: 'downloading' })
    mac.tick(ICLOUD_FIRST_SYNC_GRACE_MS - 60_000)
    expect(await mac.sync()).toMatchObject({ kind: 'skipped', reason: 'downloading' })
    expect(drive.names()).toEqual([])                          // no file of its own under the iPhone's name

    // iCloud lists the iPhone's file on this Mac.
    const phone = device('phone', drive.phoneBridge, withMilestones([milestone('a', 'Moved to Denver', '2026-11-14T09:00:00.000Z')]))
    await phone.sync()
    const arrived = fs.readFileSync(drive.file, 'utf-8')

    mac.tick(15_000)
    const asked = await mac.sync()
    expect(asked).toMatchObject({ kind: 'prompted' })
    expect(asked.info.data.lives.default.milestones).toHaveLength(1)
    expect(titles(mac.store)).toEqual([])                      // nothing restored yet
    expect(fs.readFileSync(drive.file, 'utf-8')).toBe(arrived) // and nothing written

    mac.transport.setEnabled(true)                             // "Restore from iCloud"
    expect(await mac.sync()).toMatchObject({ kind: 'merged', applied: true })
    expect(titles(mac.store)).toEqual(['Moved to Denver'])
  })

  it('a Mac with a timeline of its own waits too, then merges rather than overwrites', async () => {
    const drive = iCloudDrive()
    const mac = device('mac', drive.macBridge, withMilestones([milestone('m', 'New job', '2026-11-15T09:00:00.000Z')]))
    expect(await mac.sync()).toMatchObject({ kind: 'skipped', reason: 'downloading' })
    expect(drive.names()).toEqual([])

    const phone = device('phone', drive.phoneBridge, withMilestones([milestone('a', 'Moved to Denver', '2026-11-14T09:00:00.000Z')]))
    await phone.sync()
    mac.tick(15_000)
    expect(await mac.sync()).toMatchObject({ kind: 'merged', applied: true })
    expect(titles(mac.store)).toEqual(['Moved to Denver', 'New job'])
  })

  it('seeds the file once it is still missing after the wait', async () => {
    const drive = iCloudDrive()
    const mac = device('mac', drive.macBridge, withMilestones([milestone('m', 'New job', '2026-11-15T09:00:00.000Z')]))
    expect(await mac.sync()).toMatchObject({ kind: 'skipped', reason: 'downloading' })
    mac.tick(ICLOUD_FIRST_SYNC_GRACE_MS)
    expect(await mac.sync()).toMatchObject({ kind: 'seeded', wrote: true })
    expect(drive.names()).toEqual([ICLOUD_SYNC_FILE])
  })

  it('once it has synced, a missing file is the shared eviction rule, not this wait', async () => {
    const drive = iCloudDrive()
    const phone = device('phone', drive.phoneBridge, withMilestones([milestone('a', 'Moved to Denver', '2026-11-14T09:00:00.000Z')]))
    await phone.sync()
    const mac = device('mac', drive.macBridge, withMilestones([milestone('m', 'New job', '2026-11-15T09:00:00.000Z')]))
    expect(await mac.sync()).toMatchObject({ kind: 'merged' })
    fs.rmSync(drive.file)
    expect(await mac.sync()).toMatchObject({ kind: 'skipped', reason: 'missing-grace' })
  })

  it('goes quiet when the container folder is not there, and writes nothing into it', async () => {
    const drive = iCloudDrive()
    fs.rmSync(drive.docs, { recursive: true })
    const mac = device('mac', drive.macBridge, withMilestones([milestone('m', 'New job', '2026-11-15T09:00:00.000Z')]))
    expect(await mac.sync()).toBeNull()
    expect(fs.existsSync(drive.docs)).toBe(false)
  })
})
