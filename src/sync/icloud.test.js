import { describe, it, expect, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}))

import {
  createICloudTransport, getICloudSyncPref, isICloudSyncEnabled, setICloudSyncEnabled,
  ICLOUD_SYNC_PREF_KEY, ICLOUD_LAST_SYNCED_KEY, ICLOUD_DOWNLOAD_GRACE_MS, ICLOUD_SYNC_FILE,
} from './icloud.js'
import { createICloudBridge } from '../native/icloud.js'

const memStorage = () => {
  const m = new Map()
  const s = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: (k) => { m.delete(k) } }
  return () => s
}

/** An iCloud container as a map of paths, with a download state per path. */
function fakeICloud() {
  const files = new Map()
  const stale = new Map()
  const downloading = new Set()
  let available = true
  const writes = []
  const bridge = {
    available: async () => available,
    read: async (path, { allowStale = false } = {}) => {
      if (downloading.has(path)) {
        if (allowStale && stale.has(path)) return { kind: 'text', text: stale.get(path) }
        return { kind: 'downloading' }
      }
      return files.has(path) ? { kind: 'text', text: files.get(path) } : { kind: 'absent' }
    },
    write: async (path, text, { atomic = false, container = 'own' } = {}) => { files.set(path, text); writes.push({ path, atomic, container }); return true },
    list: async () => [...files.keys()],
    remove: async (path) => files.delete(path),
    makeDir: async () => true,
    onChanged: () => () => {},
  }
  return {
    bridge, files, writes,
    setAvailable: (v) => { available = v },
    stall: (path, lastDownloaded) => { downloading.add(path); if (lastDownloaded) stale.set(path, lastDownloaded) },
    land: (path) => { downloading.delete(path) },
  }
}

describe('the iCloud preference', () => {
  it('is tri-state: absent means ON and undecided', () => {
    const storage = memStorage()
    expect(getICloudSyncPref(storage)).toBeNull()
    expect(isICloudSyncEnabled(storage)).toBe(true)          // zero-config
    setICloudSyncEnabled(false, storage)
    expect(getICloudSyncPref(storage)).toBe('false')
    expect(isICloudSyncEnabled(storage)).toBe(false)
    setICloudSyncEnabled(true, storage)
    expect(getICloudSyncPref(storage)).toBe('true')
    storage().setItem(ICLOUD_SYNC_PREF_KEY, 'nonsense')
    expect(getICloudSyncPref(storage)).toBeNull()
  })
})

describe('the iCloud transport', () => {
  it('is available only with the plugin, the switch on and iCloud reachable', async () => {
    const f = fakeICloud()
    const storage = memStorage()
    const none = createICloudTransport({ bridge: () => null, storage })
    expect(none.isSupported()).toBe(false)
    expect(await none.isAvailable()).toBe(false)
    const t = createICloudTransport({ bridge: () => f.bridge, storage })
    expect(t.isSupported()).toBe(true)
    expect(await t.isAvailable()).toBe(true)
    f.setAvailable(false)
    expect(await t.isAvailable()).toBe(false)               // signed out, iCloud Drive off
    f.setAvailable(true)
    t.setEnabled(false)
    expect(await t.isAvailable()).toBe(false)               // off on this device: inert
  })

  it('is plaintext, reseeds an unreadable envelope, and asks first only until decided', () => {
    const t = createICloudTransport({ bridge: () => fakeICloud().bridge, storage: memStorage() })
    expect(t.encryptsWrites()).toBe(false)
    expect(t.allowsPlaintextReseed).toBe(true)
    expect(t.firstRunDecided()).toBe(false)
    t.setEnabled(true)
    expect(t.firstRunDecided()).toBe(true)
  })

  it('writes one file atomically in the own container, with its own seed-guard stamp', async () => {
    const f = fakeICloud()
    const t = createICloudTransport({ bridge: () => f.bridge, storage: memStorage() })
    expect(t.lastSyncedKey).toBe(ICLOUD_LAST_SYNCED_KEY)
    expect(await t.read()).toBeNull()                       // absent: the cycle seeds it
    expect(await t.write('{"lives":1}')).toBe(true)
    expect(f.files.get(ICLOUD_SYNC_FILE)).toBe('{"lives":1}')
    expect(f.writes).toEqual([{ path: 'lifeglance-sync.json', atomic: true, container: 'own' }])
  })

  it('a stalled download is waited out, then read from the last downloaded copy', async () => {
    const f = fakeICloud()
    let now = 0
    const t = createICloudTransport({ bridge: () => f.bridge, storage: memStorage(), now: () => now, log: { warn: () => {} } })
    f.stall(ICLOUD_SYNC_FILE, '{"old":true}')
    expect(await t.read()).toBe('{"downloading":true}')
    now += ICLOUD_DOWNLOAD_GRACE_MS - 1
    expect(await t.read()).toBe('{"downloading":true}')
    now += 2
    expect(await t.read()).toBe('{"old":true}')              // past the window: merge into what we have
    f.land(ICLOUD_SYNC_FILE)
    f.files.set(ICLOUD_SYNC_FILE, '{"new":true}')
    expect(await t.read()).toBe('{"new":true}')
    f.stall(ICLOUD_SYNC_FILE, '{"old":true}')
    expect(await t.read()).toBe('{"downloading":true}')      // the clock restarted after a real read
  })

  it('a stall with no bytes on the device keeps waiting', async () => {
    const f = fakeICloud()
    let now = 0
    const t = createICloudTransport({ bridge: () => f.bridge, storage: memStorage(), now: () => now })
    f.stall(ICLOUD_SYNC_FILE)
    expect(await t.read()).toBe('{"downloading":true}')
    now += ICLOUD_DOWNLOAD_GRACE_MS + 1
    expect(await t.read()).toBe('{"downloading":true}')
  })

  it('reports a shell error in the shape the cycle reads as an error', async () => {
    const f = fakeICloud()
    f.bridge.read = async () => ({ kind: 'error', error: 'not signed in' })
    const t = createICloudTransport({ bridge: () => f.bridge, storage: memStorage() })
    expect(JSON.parse(await t.read())).toEqual({ error: 'not signed in' })
  })
})

describe('the iCloud bridge', () => {
  const plugin = (over = {}) => ({
    available: vi.fn(async () => ({ available: true })),
    readFile: vi.fn(async () => ({ kind: 'text', text: 'x' })),
    writeFile: vi.fn(async () => ({ ok: true })),
    listFiles: vi.fn(async () => ({ names: ['a.json'] })),
    deleteFile: vi.fn(async () => ({ ok: true })),
    makeDir: vi.fn(async () => ({ ok: true })),
    addListener: vi.fn(async () => ({ remove: async () => {} })),
    ...over,
  })

  it('passes the container, the stale flag and the atomic flag through', async () => {
    const p = plugin()
    const b = createICloudBridge(p)
    await b.read('GLANCE/events/x.json', { container: 'dayglance', allowStale: true })
    expect(p.readFile).toHaveBeenCalledWith({ path: 'GLANCE/events/x.json', container: 'dayglance', allowStale: true })
    await b.write('lifeglance-sync.json', 't', { atomic: true })
    expect(p.writeFile).toHaveBeenCalledWith({ path: 'lifeglance-sync.json', text: 't', container: 'own', atomic: true })
    expect(await b.list('GLANCE/events/', 'dayglance')).toEqual(['a.json'])
  })

  it('answers every failure rather than throwing', async () => {
    const boom = async () => { throw new Error('nope') }
    const b = createICloudBridge(plugin({ available: boom, readFile: boom, writeFile: boom, listFiles: boom, deleteFile: boom, makeDir: boom }))
    expect(await b.available()).toBe(false)
    expect(await b.read('x')).toEqual({ kind: 'error', error: 'nope' })
    expect(await b.write('x', 'y')).toBe(false)
    expect(await b.list('x')).toBeNull()
    expect(await b.remove('x')).toBe(false)
    expect(await b.makeDir('x')).toBe(false)
    const odd = createICloudBridge(plugin({ readFile: vi.fn(async () => ({})), listFiles: vi.fn(async () => ({ names: null })) }))
    expect(await odd.read('x')).toEqual({ kind: 'error', error: 'bad answer from the shell' })
    expect(await odd.list('x')).toBeNull()                    // iCloud away
  })
})
