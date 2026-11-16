import { afterEach, describe, it, expect, vi } from 'vitest'

// The plugin contracts the desktop app answers in place of a Capacitor shell
// (docs/desktop-app.md): secure storage, Direct Access and GLANCEvault's push.
// Capacitor reads 'web' there, as in the real desktop app; each module is
// imported fresh, since some decide what they are at load.

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web', isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}))

function desktop(groups, info = {}) {
  vi.stubGlobal('window', { lifeGlanceDesktop: { info: { platform: 'linux', secureStorage: true, ...info }, shell: { setTheme() {} }, ...groups } })
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('secure storage', () => {
  const fakeStore = () => {
    const items = new Map()
    return {
      get: vi.fn(async ({ key }) => ({ value: items.get(key) ?? null })),
      set: vi.fn(async ({ key, value }) => { items.set(key, value) }),
      delete: vi.fn(async ({ key }) => { items.delete(key) }),
    }
  }

  it('is off on the web', async () => {
    const { isSecureStoreAvailable } = await import('./secureStore.js')
    expect(isSecureStoreAvailable).toBe(false)
  })

  it('is the desktop app\'s keychain store where the OS protects secrets', async () => {
    const store = fakeStore()
    desktop({ secureStore: store })
    const { isSecureStoreAvailable, secureGet, secureSet, secureDelete } = await import('./secureStore.js')
    expect(isSecureStoreAvailable).toBe(true)
    await secureSet('lifeglance-cloud-sync-config', '{"password":"p"}')
    expect(await secureGet('lifeglance-cloud-sync-config')).toBe('{"password":"p"}')
    await secureDelete('lifeglance-cloud-sync-config')
    expect(await secureGet('lifeglance-cloud-sync-config')).toBeNull()
    expect(store.set).toHaveBeenCalledWith({ key: 'lifeglance-cloud-sync-config', value: '{"password":"p"}' })
  })

  it('stays off on a desktop with nothing to protect secrets with, rather than claim it', async () => {
    desktop({ secureStore: fakeStore() }, { secureStorage: false })
    const { isSecureStoreAvailable } = await import('./secureStore.js')
    expect(isSecureStoreAvailable).toBe(false)
  })
})

describe('Direct Access', () => {
  const folder = () => {
    const listeners = new Set()
    const calls = []
    const answer = (name, value) => vi.fn(async (o) => { calls.push([name, o]); return value })
    return {
      calls, listeners,
      status: answer('status', { configured: true, name: 'GLANCE', path: '/sync/GLANCE', reachable: true }),
      pickFolder: answer('pickFolder', { configured: true, name: 'GLANCE', path: '/sync/GLANCE', reachable: true }),
      disconnect: answer('disconnect', undefined),
      read: answer('read', { kind: 'text', text: '{}' }),
      write: answer('write', { ok: true }),
      deleteFile: answer('deleteFile', { ok: true }),
      listFiles: answer('listFiles', { names: ['a.json'] }),
      readFile: answer('readFile', { kind: 'absent' }),
      writeFile: answer('writeFile', { ok: true }),
      deleteFileAt: answer('deleteFileAt', { ok: true }),
      makeDir: answer('makeDir', { ok: true }),
      onChanged: vi.fn((cb) => { listeners.add(cb); return () => listeners.delete(cb) }),
    }
  }

  it('is not there on the web', async () => {
    const { isDirectAccessAvailable, desktopDirectAccess } = await import('./directAccess.js')
    expect(isDirectAccessAvailable()).toBe(false)
    expect(desktopDirectAccess()).toBeNull()
  })

  it('is a folder, as on Android: pick a folder, and files by path below it', async () => {
    const d = folder()
    desktop({ directAccess: d })
    const { isDirectAccessAvailable, createDirectAccessBridge, desktopDirectAccessPlugin } = await import('./directAccess.js')
    expect(isDirectAccessAvailable()).toBe(true)
    const bridge = createDirectAccessBridge(desktopDirectAccessPlugin(d), 'android')
    expect(await bridge.pick()).toMatchObject({ configured: true, name: 'GLANCE' })
    expect(d.pickFolder).toHaveBeenCalled()
    expect(await bridge.read()).toEqual({ kind: 'text', text: '{}' })
    expect(await bridge.write('{"a":1}')).toBe(true)
    expect(await bridge.paths.list('GLANCE/events')).toEqual(['a.json'])
    expect(await bridge.paths.write('GLANCE/events/e.json', '{}')).toBe(true)
    expect(d.calls).toContainEqual(['writeFile', { rel: 'GLANCE/events/e.json', text: '{}' }])
    // The iOS file slots do not exist on a folder.
    expect(bridge.users).toBeUndefined()
    expect(await bridge.pickFile('users')).toMatchObject({ error: 'Not available on the desktop' })
  })

  it('joins the folder watcher while something is listening for changes', async () => {
    const d = folder()
    desktop({ directAccess: d })
    const { createDirectAccessTransport } = await import('../sync/directAccess.js')
    const m = new Map()
    const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: (k) => { m.delete(k) } }
    const transport = createDirectAccessTransport({ storage: () => storage, log: { warn() {}, error() {} } })
    expect(transport.isSupported()).toBe(true)
    const onChanged = vi.fn()
    const off = transport.onChanged(onChanged)
    expect(d.listeners.size).toBe(1)
    for (const cb of d.listeners) cb()                          // another program wrote the file
    expect(onChanged).toHaveBeenCalledTimes(1)
    off()
    expect(d.listeners.size).toBe(0)
  })
})

describe('GLANCEvault\'s push', () => {
  it('has no shell reader on the web, which reads the stream itself', async () => {
    const { vaultSseBridge } = await import('./vaultSse.js')
    expect(vaultSseBridge()).toBeNull()
  })

  it('is read by the desktop app\'s main process: start, stop, and its messages', async () => {
    const listeners = new Set()
    const vaultSse = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      onMessage: vi.fn((cb) => { listeners.add(cb); return () => listeners.delete(cb) }),
    }
    desktop({ vaultSse })
    const { vaultSseBridge } = await import('./vaultSse.js')
    const shell = vaultSseBridge()
    const seen = []
    const unlisten = shell.listen((m) => seen.push(m))
    await shell.start({ vaultUrl: 'https://vault.example.com', vaultToken: 't', accountId: 'a' })
    for (const cb of listeners) cb({ type: 'frame', block: 'data: {"seq":1}' })
    expect(vaultSse.start).toHaveBeenCalledWith({ vaultUrl: 'https://vault.example.com', vaultToken: 't', accountId: 'a' })
    expect(seen).toEqual([{ type: 'frame', block: 'data: {"seq":1}' }])
    unlisten()
    expect(listeners.size).toBe(0)
    await shell.stop()
    expect(vaultSse.stop).toHaveBeenCalled()
  })
})
