import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// In-memory stand-in for the native SecureStore plugin. `availability` is
// mutable so individual tests can exercise the no-plugin no-op path, `broken`
// simulates a native layer whose calls all reject (lastGLANCE's 2.1.0 rc
// Keystore bug) to pin down the fail-open behavior, and `lying` simulates a
// write that resolves successfully without persisting — the case the
// read-back-before-delete deviation exists for.
const nativeStore = new Map()
const availability = { value: true }
const broken = { value: false }
const lying = { value: false }
vi.mock('../native/secureStore.js', () => ({
  get isSecureStoreAvailable() { return availability.value },
  secureGet: vi.fn(async (key) => {
    if (broken.value) throw new Error('native failure')
    return nativeStore.has(key) ? nativeStore.get(key) : null
  }),
  secureSet: vi.fn(async (key, value) => {
    if (broken.value) throw new Error('native failure')
    if (lying.value) return // resolves, stores nothing
    nativeStore.set(key, value)
  }),
  secureDelete: vi.fn(async (key) => {
    if (broken.value) throw new Error('native failure')
    nativeStore.delete(key)
  }),
}))

// The vitest environment is node: no Storage / window / localStorage. The shim
// patches Storage.prototype and distinguishes localStorage from sessionStorage
// by identity, so the fixture must model both on a real prototype chain.
class FakeStorage {
  constructor() { this.store = new Map() }
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null }
  setItem(k, v) { this.store.set(k, String(v)) }
  removeItem(k) { this.store.delete(k) }
  clear() { this.store.clear() }
  key(i) { return Array.from(this.store.keys())[i] ?? null }
  get length() { return this.store.size }
}

const SECRET_KEY = 'lifeglance-cloud-sync-config'

let shim

describe('secureConfigShim', () => {
  beforeEach(async () => {
    globalThis.Storage = FakeStorage
    globalThis.localStorage = new FakeStorage()
    globalThis.sessionStorage = new FakeStorage()
    globalThis.window = globalThis
    nativeStore.clear()
    availability.value = true
    broken.value = false
    lying.value = false
    vi.resetModules()
    shim = await import('./secureConfigShim.js')
  })

  afterEach(() => {
    shim.uninstallSecureConfigShimForTests()
  })

  it('passes non-secret keys through to real localStorage', async () => {
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    localStorage.setItem('lifeglance-theme', 'dark')
    expect(localStorage.getItem('lifeglance-theme')).toBe('dark')
    expect(nativeStore.size).toBe(0)
  })

  it('serves secret keys from the cache and writes through to the native store', async () => {
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    const cfg = JSON.stringify({ enabled: true, appPassword: 'hunter2', vaultToken: 'tok' })
    localStorage.setItem(SECRET_KEY, cfg)
    // Synchronous read-back straight from the cache — this is the contract the
    // sync engine's synchronous config reads depend on.
    expect(localStorage.getItem(SECRET_KEY)).toBe(cfg)
    await shim.flushSecureWrites()
    expect(nativeStore.get(SECRET_KEY)).toBe(cfg)
    // The real localStorage must never have seen the value.
    shim.uninstallSecureConfigShimForTests()
    expect(localStorage.getItem(SECRET_KEY)).toBeNull()
  })

  it('removeItem clears both cache and native store', async () => {
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    localStorage.setItem(SECRET_KEY, 'v')
    localStorage.removeItem(SECRET_KEY)
    expect(localStorage.getItem(SECRET_KEY)).toBeNull()
    await shim.flushSecureWrites()
    expect(nativeStore.has(SECRET_KEY)).toBe(false)
  })

  it('migrates legacy plaintext out of localStorage on hydrate', async () => {
    const legacy = JSON.stringify({ webdavPass: 'pw_legacy' })
    localStorage.setItem('lifeglance-intents-config', legacy)
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    // Served from the cache, present in the native store, gone from disk.
    expect(localStorage.getItem('lifeglance-intents-config')).toBe(legacy)
    expect(nativeStore.get('lifeglance-intents-config')).toBe(legacy)
    shim.uninstallSecureConfigShimForTests()
    expect(localStorage.getItem('lifeglance-intents-config')).toBeNull()
  })

  it('hydrates previously stored secrets from the native store', async () => {
    nativeStore.set('lifeglance-intents-config', '{"webdavPass":"pw"}')
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    expect(localStorage.getItem('lifeglance-intents-config')).toBe('{"webdavPass":"pw"}')
  })

  it('a wiped native store (device transfer) reads as absent', async () => {
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    expect(localStorage.getItem(SECRET_KEY)).toBeNull()
  })

  it('does not touch sessionStorage', async () => {
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    sessionStorage.setItem(SECRET_KEY, 'session-value')
    expect(sessionStorage.getItem(SECRET_KEY)).toBe('session-value')
    await shim.flushSecureWrites()
    expect(nativeStore.size).toBe(0)
  })

  it('a failing native layer still serves legacy settings and keeps the plaintext for retry', async () => {
    // Regression pinned in lastGLANCE: the 2.1.0 rc Keystore bug made every
    // secureSet reject, and hydration left the cache empty while the shim
    // shadowed the intact plaintext — presenting as wiped sync settings.
    const legacy = JSON.stringify({ enabled: true, appPassword: 'hunter2' })
    localStorage.setItem(SECRET_KEY, legacy)
    broken.value = true
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    // Settings must still be readable through the shim...
    expect(localStorage.getItem(SECRET_KEY)).toBe(legacy)
    // ...and the plaintext must survive for the next boot's retry.
    shim.uninstallSecureConfigShimForTests()
    expect(localStorage.getItem(SECRET_KEY)).toBe(legacy)
    expect(nativeStore.size).toBe(0)
  })

  it('a native write that resolves without persisting keeps the plaintext (read-back verify)', async () => {
    // Deliberate deviation from lastGLANCE: the migration reads the value back
    // before deleting the only other copy, so a native layer that lies about
    // success cannot cost the user their WebDAV password.
    const legacy = JSON.stringify({ enabled: true, appPassword: 'hunter2' })
    localStorage.setItem(SECRET_KEY, legacy)
    lying.value = true
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    // Still served this session, and the plaintext survives for the retry.
    expect(localStorage.getItem(SECRET_KEY)).toBe(legacy)
    shim.uninstallSecureConfigShimForTests()
    expect(localStorage.getItem(SECRET_KEY)).toBe(legacy)
  })

  it('is a no-op when the secure store is unavailable (web / PWA / old shell)', async () => {
    availability.value = false
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    localStorage.setItem(SECRET_KEY, 'plain')
    // Without the shim installed, behavior is the status quo: plain localStorage.
    expect(localStorage.getItem(SECRET_KEY)).toBe('plain')
    expect(nativeStore.size).toBe(0)
  })
})
