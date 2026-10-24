import 'fake-indexeddb/auto'
import { afterAll, describe, expect, it, vi } from 'vitest'

// krelltunez/dayGLANCE#2142: @glance-apps/sync 2.3 stops a WebDAV poll at a
// conditional GET when neither side moved since a cycle that changed nothing.
// The gate compares JSON.stringify(buildPayload().data) between polls, so it
// only fires for an app whose payload is stable while nothing changes (no
// timestamps built per call). This walks lifeGLANCE's own initSyncEngine and
// payload so a payload change that defeats the gate fails here.

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
await initDB()

const milestone = { id: 'm1', title: 'Moved to Lisbon', date: '2020-03-01', updatedAt: '2026-01-01T00:00:00.000Z' }

// A WebDAV server holding one file: GET answers the stored copy, or 304 to a
// matching If-None-Match; PUT replaces it under a new ETag.
function fakeServer() {
  let file = null
  let n = 0
  return {
    name: 'fake', configFields: [], test: vi.fn(),
    download: vi.fn(async (_cfg, { ifNoneMatch } = {}) => {
      if (!file) return null
      if (ifNoneMatch && ifNoneMatch === file.etag) return { notModified: true, etag: ifNoneMatch }
      return { payload: structuredClone(file.payload), etag: file.etag }
    }),
    upload: vi.fn(async (_cfg, envelope) => {
      file = { payload: structuredClone(envelope), etag: `"e${++n}"` }
      return true
    }),
  }
}

async function cycle(engine) {
  vi.useFakeTimers()
  const p = engine.download()
  await vi.advanceTimersByTimeAsync(3000)
  await p
  vi.useRealTimers()
}

describe('WebDAV idle gate through lifeGLANCE\'s engine (@glance-apps/sync 2.3)', () => {
  it('an unchanged poll stops at the 304; a local edit takes the full cycle again', async () => {
    const milestonesRef = { current: [milestone] }
    const setMilestones = vi.fn()
    const status = []
    const engine = initSyncEngine({
      milestonesRef, chaptersRef: { current: [] },
      setMilestones, setChapters: vi.fn(),
      setSyncStatus: (s) => { status.push(s) },
      setSyncError: () => {}, setSyncHalted: () => {}, setLastSynced: () => {},
      setShowPassphraseModal: () => {}, setVaultSkipped: () => {},
    })
    const server = fakeServer()
    Object.keys(engine.providers).forEach((k) => delete engine.providers[k])
    engine.providers.fake = server
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify({ enabled: true, provider: 'fake' }))

    await cycle(engine) // empty remote: seeded
    expect(server.upload).toHaveBeenCalledTimes(1)
    await cycle(engine) // full read and merge, nothing to do: settles
    expect(server.download).toHaveBeenLastCalledWith(expect.anything(), undefined)

    setMilestones.mockClear()
    status.length = 0
    await cycle(engine) // the gate: conditional GET answered 304
    expect(server.download).toHaveBeenLastCalledWith(expect.anything(), { ifNoneMatch: '"e1"' })
    expect(server.upload).toHaveBeenCalledTimes(1)
    expect(setMilestones).not.toHaveBeenCalled()
    expect(status).toContain('success')

    milestonesRef.current = [milestone, { ...milestone, id: 'm2', title: 'Started a new job' }]
    await cycle(engine) // local data moved: no conditional GET, the edit goes up
    expect(server.download).toHaveBeenLastCalledWith(expect.anything(), undefined)
    expect(server.upload).toHaveBeenCalledTimes(2)
  })
})
