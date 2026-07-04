import { describe, it, expect, beforeEach, vi } from 'vitest'

// Capture the config every createSyncEngine call receives so we can assert which
// appFolderName the engine was built with. Everything else the package exports is
// stubbed to a no-op so engine.js (and adapter.js's static imports) load cleanly.
const built = []
vi.mock('@glance-apps/sync', () => ({
  createSyncEngine: (cfg) => { built.push(cfg); return { id: built.length, cfg } },
  // Named exports statically imported by adapter.js; unused here, just present.
  mergeArrayById: () => [],
  pruneTombstones: () => [],
}))

// The test env is 'node' (no DOM). engine.js only needs a get/set/clear store.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const CONFIG_KEY = 'lifeglance-cloud-sync-config'
const noopParams = {
  milestonesRef: { current: [] }, chaptersRef: { current: [] },
  setMilestones: () => {}, setChapters: () => {}, setSyncStatus: () => {},
  setSyncError: () => {}, setSyncHalted: () => {}, setLastSynced: () => {},
  setShowPassphraseModal: () => {}, setVaultSkipped: () => {},
}

describe('reinitSyncEngine', () => {
  beforeEach(() => {
    built.length = 0
    localStorage.clear()
  })

  it('rebuilds the engine with the sync folder saved since construction', async () => {
    const { initSyncEngine, reinitSyncEngine, getSyncEngine } = await import('./engine.js')

    // First build: no saved folder → the default appFolderName.
    initSyncEngine(noopParams)
    expect(built.at(-1).appFolderName).toBe('GLANCE/lifeglance')
    const first = getSyncEngine()

    // The user saves a new sync folder (persisted the way setConfig persists it).
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ folder: 'photo/GLANCE/lifeglance' }))

    // Reinit rebuilds a fresh engine that re-reads the folder from localStorage.
    const rebuilt = reinitSyncEngine()
    expect(built.at(-1).appFolderName).toBe('photo/GLANCE/lifeglance')
    expect(rebuilt).not.toBe(first)
    expect(getSyncEngine()).toBe(rebuilt)
  })

  it('is a no-op before initSyncEngine has ever run', async () => {
    vi.resetModules()
    const { reinitSyncEngine } = await import('./engine.js')
    expect(reinitSyncEngine()).toBe(null)
    expect(built).toHaveLength(0)
  })
})
