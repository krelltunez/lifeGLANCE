import { describe, it, expect, vi } from 'vitest'
import { createDirectAccessTransport, DIRECT_ACCESS_ENCRYPT_KEY, DIRECT_ACCESS_LAST_SYNCED_KEY, DIRECT_ACCESS_PREF_KEY } from './directAccess.js'


const memStorage = () => {
  const m = new Map()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v) },
    removeItem: (k) => { m.delete(k) },
  }
}

const sameStorage = () => { const st = memStorage(); return () => st }

const connected = { configured: true, name: 'GLANCE', path: 'content://tree/GLANCE', reachable: true }

function fakeBridge(platform, overrides = {}) {
  let status = { configured: false, name: null, path: null, reachable: false }
  let read = { kind: 'absent' }
  const written = []
  const pathFiles = new Map()
  const dirs = new Set()
  const bridge = {
    restore: async () => status,
    status: async () => status,
    pick: async () => { status = connected; return status },
    pickFile: async (slot) => ({ ...connected, slot }),
    createFile: async (slot) => ({ ...connected, slot }),
    disconnect: async () => { status = { configured: false, name: null, path: null, reachable: false }; return true },
    read: async () => read,
    write: async (text) => { written.push(text); return true },
    deleteFile: async () => true,
    ...(platform === 'android'
      ? {
          paths: {
            list: async (rel) => [...pathFiles.keys()].filter((p) => p.startsWith(rel ? rel + '/' : '')).map((p) => p.slice(rel ? rel.length + 1 : 0)),
            read: async (rel) => (pathFiles.has(rel) ? { kind: 'text', text: pathFiles.get(rel) } : { kind: 'absent' }),
            write: async (rel, text) => {
              const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
              if (dir && !dirs.has(dir)) return false
              pathFiles.set(rel, text); return true
            },
            remove: async (rel) => pathFiles.delete(rel),
            makeDir: async (rel) => { dirs.add(rel); return true },
          },
        }
      : {
          users: { status: async () => ({ configured: false, name: null, path: null, reachable: false }), read: async () => ({ kind: 'absent' }), write: async (t) => { written.push('users:' + t); return true }, forget: async () => true },
          events: { status: async () => ({ configured: true, name: 'glance-events.json', path: '/x', reachable: true }), read: async () => ({ kind: 'text', text: '{"events":[]}' }), write: async () => true, forget: async () => true },
        }),
    ...overrides,
  }
  return {
    bridge,
    written,
    pathFiles,
    setStatus: (s) => { status = s },
    setRead: (r) => { read = r },
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('Direct Access transport: connection state', () => {
  it('is unknown until the shell restores, then reflects configured and reachable', async () => {
    const f = fakeBridge('android')
    f.setStatus({ ...connected, reachable: false })
    const t = createDirectAccessTransport({ bridge: () => f.bridge, storage: sameStorage() })
    expect(t.getSnapshot().status).toBe('unknown')
    expect(t.isAvailable()).toBe(false)   // kicks the restore
    await settle()
    expect(t.getSnapshot()).toMatchObject({ status: 'unreachable', name: 'GLANCE', connected: true, enabled: true })
    // While unreachable, each availability check re-probes the shell.
    f.setStatus(connected)
    const changed = vi.fn()
    t.onChanged(changed)
    expect(t.isAvailable()).toBe(false)
    await settle()
    expect(t.getSnapshot().status).toBe('connected')
    expect(t.isAvailable()).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('without a bridge (web, old shell) it is unsupported and never available', () => {
    const t = createDirectAccessTransport({ bridge: () => null, storage: sameStorage() })
    expect(t.isSupported()).toBe(false)
    expect(t.isAvailable()).toBe(false)
    expect(t.getSnapshot().supported).toBe(false)
  })
})

describe('Direct Access transport: the read contract', () => {
  it('maps the shell classification onto the string contract the cycle reads', async () => {
    const f = fakeBridge('android')
    f.setStatus(connected)
    const t = createDirectAccessTransport({ bridge: () => f.bridge, storage: sameStorage() })
    await t.subscribe(() => {})
    await settle()
    expect(await t.read()).toBeNull()
    f.setRead({ kind: 'downloading' })
    expect(JSON.parse(await t.read())).toEqual({ downloading: true })
    f.setRead({ kind: 'text', text: '{"data":{}}' })
    expect(await t.read()).toBe('{"data":{}}')
    expect(t.getSnapshot().status).toBe('connected')
    // An error marks the folder unreachable once; the cycle surfaces the error object.
    f.setRead({ kind: 'error', error: 'grant revoked' })
    expect(JSON.parse(await t.read())).toEqual({ error: 'grant revoked' })
    expect(t.getSnapshot().status).toBe('unreachable')
  })

  it('writes through the shell and answers its boolean', async () => {
    const f = fakeBridge('android')
    const t = createDirectAccessTransport({ bridge: () => f.bridge, storage: sameStorage() })
    expect(await t.write('x')).toBe(true)
    expect(f.written).toEqual(['x'])
  })
})

describe('Direct Access transport: picking and forgetting', () => {
  it('a pick turns the preference on, clears the last-synced stamp and kicks a cycle', async () => {
    const f = fakeBridge('android')
    const storage = memStorage()
    storage.setItem(DIRECT_ACCESS_LAST_SYNCED_KEY, '2026-10-01T00:00:00.000Z')
    storage.setItem(DIRECT_ACCESS_PREF_KEY, 'false')
    const t = createDirectAccessTransport({ bridge: () => f.bridge, storage: () => storage })
    const changed = vi.fn()
    t.onChanged(changed)
    const snap = await t.pickFolder()
    expect(snap).toMatchObject({ status: 'connected', name: 'GLANCE', enabled: true, pickError: null })
    expect(storage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY)).toBeNull()
    expect(storage.getItem(DIRECT_ACCESS_PREF_KEY)).toBe('true')
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('a cancelled picker changes nothing; a refused one shows why until the next pick', async () => {
    const f = fakeBridge('android', { pick: async () => null })
    const t = createDirectAccessTransport({ bridge: () => f.bridge, storage: sameStorage(), log: { warn: () => {} } })
    expect(await t.pickFolder()).toBeNull()
    expect(t.getSnapshot()).toMatchObject({ status: 'unknown', pickError: null })
    const g = fakeBridge('ios', { pickFile: async () => ({ error: 'that is not lifeglance-sync.json', path: '/Nextcloud/notes.json' }) })
    const u = createDirectAccessTransport({ bridge: () => g.bridge, storage: sameStorage(), log: { warn: () => {} } })
    expect(await u.pickFile()).toBeNull()
    expect(u.getSnapshot().pickError).toBe('that is not lifeglance-sync.json (/Nextcloud/notes.json)')
    g.bridge.pickFile = async () => connected
    await u.pickFile()
    expect(u.getSnapshot()).toMatchObject({ status: 'connected', pickError: null })
  })

  it('a picker that never answers is reported after the timeout', async () => {
    const f = fakeBridge('android', { pick: () => new Promise(() => {}) })
    const timers = []
    const t = createDirectAccessTransport({
      bridge: () => f.bridge, storage: sameStorage(), log: { warn: () => {} },
      setTimer: (fn) => { timers.push(fn); return 1 },
      clearTimer: () => {},
    })
    const pending = t.pickFolder()
    timers[0]()
    expect(await pending).toBeNull()
    expect(t.getSnapshot().pickError).toBe('the picker returned no result')
  })

  it('disconnect forgets the folder, the last-synced stamp and the encrypt switch', async () => {
    const f = fakeBridge('android')
    const storage = memStorage()
    const t = createDirectAccessTransport({ bridge: () => f.bridge, storage: () => storage })
    await t.pickFolder()
    t.setEncryptsWrites(true)
    expect(storage.getItem(DIRECT_ACCESS_ENCRYPT_KEY)).toBe('true')
    expect(t.getSnapshot().encrypt).toBe(true)
    storage.setItem(DIRECT_ACCESS_LAST_SYNCED_KEY, 'x')
    await t.disconnect()
    expect(t.getSnapshot()).toMatchObject({ status: 'disconnected', name: null, encrypt: false, connected: false })
    expect(storage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY)).toBeNull()
    expect(storage.getItem(DIRECT_ACCESS_ENCRYPT_KEY)).toBeNull()
  })

  it('the switches: off is inert, on kicks a cycle', () => {
    const f = fakeBridge('android')
    const t = createDirectAccessTransport({ bridge: () => f.bridge, storage: sameStorage() })
    const changed = vi.fn()
    t.onChanged(changed)
    t.setEnabled(false)
    expect(t.isEnabled()).toBe(false)
    expect(changed).not.toHaveBeenCalled()
    t.setEnabled(true)
    t.setEncryptsWrites(true)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(t.encryptsWrites()).toBe(true)
    expect(t.firstRunDecided()).toBe(true)
    expect(t.allowsPlaintextReseed).toBe(false)
  })
})

describe('Direct Access transport: files beside the snapshot', () => {
  it('Android: a slot is a path in the folder, and a failed write creates the directory first', async () => {
    const f = fakeBridge('android')
    const t = createDirectAccessTransport({ bridge: () => f.bridge, storage: sameStorage() })
    expect(t.roster.supported()).toBe(true)
    expect(await t.roster.read('GLANCE/users/glance-users.json')).toBeNull()
    expect(await t.roster.write('GLANCE/users/glance-users.json', '{"users":[]}')).toBe(true)
    expect(f.pathFiles.get('GLANCE/users/glance-users.json')).toBe('{"users":[]}')
    expect(await t.roster.read('GLANCE/users/glance-users.json')).toBe('{"users":[]}')
    expect(t.files.supported()).toBe(true)
    expect(await t.files.list('GLANCE/users')).toEqual(['glance-users.json'])
    expect(await t.files.remove('GLANCE/users/glance-users.json')).toBe(true)
    expect(await t.files.list('GLANCE/users')).toEqual([])
  })

  it('iOS: a slot is its own bookmarked file, with its own status', async () => {
    const f = fakeBridge('ios')
    const t = createDirectAccessTransport({ bridge: () => f.bridge, storage: sameStorage() })
    t.subscribe(() => {})
    await settle()
    expect(t.getSnapshot().roster).toEqual({ configured: false, name: null, path: null, reachable: false })
    expect(t.getSnapshot().events).toMatchObject({ configured: true, name: 'glance-events.json' })
    expect(await t.roster.write('ignored/path', '{"users":[1]}')).toBe(true)
    expect(f.written).toEqual(['users:{"users":[1]}'])
    expect(await t.events.read('ignored/path')).toBe('{"events":[]}')
    expect(t.files.supported()).toBe(false)
    expect(await t.files.list('x')).toBeNull()
    await t.pickUsersFile()
    expect(t.getSnapshot().roster).toMatchObject({ configured: true, name: 'GLANCE' })
    expect(t.getSnapshot().status).toBe('disconnected')   // the snapshot's own state is untouched
    await t.forgetUsersFile()
    expect(t.getSnapshot().roster).toMatchObject({ configured: false })
  })
})
