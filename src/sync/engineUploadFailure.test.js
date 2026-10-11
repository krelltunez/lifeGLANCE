import 'fake-indexeddb/auto'
import { afterAll, describe, expect, it, vi } from 'vitest'

// krelltunez/dayGLANCE#2037: a WebDAV cycle whose upload failed still stamped
// "Last synced" and reported success, so a device whose writes never reached
// the server looked synced forever. Fixed in @glance-apps/sync 2.1.1; this walks
// lifeGLANCE's own initSyncEngine so a later package bump cannot quietly bring
// the masking back.

const store = new Map()
const originalLocalStorage = globalThis.localStorage
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size },
}
afterAll(() => { globalThis.localStorage = originalLocalStorage })

const { initSyncEngine } = await import('./engine.js')
const { initDB } = await import('../data/db.js')
// The app opens the database at startup; buildPayload reads it.
await initDB()

const LAST_SYNCED_KEY = 'lifeglance-cloud-sync-last-synced'

describe('WebDAV cycle with a failing upload (krelltunez/dayGLANCE#2037)', () => {
  it('seeding an empty remote: the error is reported and "Last synced" does not advance', async () => {
    const calls = { status: [], lastSynced: [], errors: [] }
    const engine = initSyncEngine({
      milestonesRef: { current: [] }, chaptersRef: { current: [] },
      setMilestones: () => {}, setChapters: () => {},
      setSyncStatus: (s) => { calls.status.push(s) },
      setSyncError: (e) => { if (e) calls.errors.push(e.code) },
      setSyncHalted: () => {},
      setLastSynced: (iso) => { calls.lastSynced.push(iso) },
      setShowPassphraseModal: () => {}, setVaultSkipped: () => {},
    })
    // initSyncEngine seeds last-synced so the engine skips the first-sync
    // conflict path; that seeded value is what must survive a failed cycle.
    const seeded = localStorage.getItem(LAST_SYNCED_KEY)
    expect(seeded).toBeTruthy()

    const provider = {
      name: 'fake', configFields: [],
      download: vi.fn(async () => null),
      upload: vi.fn(async () => { throw new Error('Upload failed: 409 Conflict') }),
      test: vi.fn(),
    }
    Object.keys(engine.providers).forEach((k) => delete engine.providers[k])
    engine.providers.fake = provider
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify({ enabled: true, provider: 'fake' }))

    vi.useFakeTimers()
    const p = engine.download()
    await vi.advanceTimersByTimeAsync(3000)
    await p
    vi.useRealTimers()

    expect(provider.upload).toHaveBeenCalled()
    expect(localStorage.getItem(LAST_SYNCED_KEY)).toBe(seeded)
    expect(calls.lastSynced).toEqual([])
    expect(calls.status).toContain('error')
    expect(calls.status).not.toContain('success')
    expect(calls.errors.length).toBeGreaterThan(0)
  })
})
