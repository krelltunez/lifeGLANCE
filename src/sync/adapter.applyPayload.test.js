// applyPayload — first-restore event (#253).
//
// The sync dot goes green on the first successful cycle, which alone doesn't
// tell a user their timeline has actually landed on a new device. applyPayload
// emits a one-time 'lifeglance:restored' event when a previously-empty device
// receives milestones, so the UI can confirm the restore is done. These tests
// pin that edge: fire once on empty→N, never on subsequent syncs, never when
// the applied payload carries no milestones.

import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

// Minimal localStorage for the node test environment (fake-indexeddb supplies
// IndexedDB only). applyPayload persists tombstones/categories to localStorage.
if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map()
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  }
}
// applyPayload dispatches on window; provide one in the node env.
if (typeof globalThis.window === 'undefined') globalThis.window = new EventTarget()

import { makeApplyPayload } from './adapter.js'
import { initDB, dbGetAll } from '../data/db.js'
import { buildMilestone } from '../data/milestones.js'

const payloadWith = (milestones) => ({ lives: { default: { milestones, chapters: [] } } })

// Capture 'lifeglance:restored' events fired during `fn`.
async function withRestoredEvents(fn) {
  const events = []
  const onRestored = (e) => events.push(e.detail)
  window.addEventListener('lifeglance:restored', onRestored)
  try { await fn() } finally { window.removeEventListener('lifeglance:restored', onRestored) }
  return events
}

describe('applyPayload — first-restore event', () => {
  beforeEach(async () => {
    global.indexedDB = new IDBFactory()
    localStorage.clear()
    await initDB()
  })

  it('fires once with the milestone count when an empty device receives data', async () => {
    const apply = makeApplyPayload(() => {}, () => {})
    const remote = [buildMilestone({ title: 'A', date: '2020-01-01' }), buildMilestone({ title: 'B', date: '2021-01-01' })]

    const events = await withRestoredEvents(() => apply(payloadWith(remote)))

    expect(events).toEqual([{ count: 2 }])
    expect((await dbGetAll()).length).toBe(2)
  })

  it('does not fire again once the device already holds milestones', async () => {
    const apply = makeApplyPayload(() => {}, () => {})
    const first = [buildMilestone({ title: 'A', date: '2020-01-01' })]
    await apply(payloadWith(first))

    // A later sync brings an additional milestone; the device is no longer empty.
    const second = [...(await dbGetAll()), buildMilestone({ title: 'B', date: '2021-01-01' })]
    const events = await withRestoredEvents(() => apply(payloadWith(second)))

    expect(events).toEqual([])
    expect((await dbGetAll()).length).toBe(2)
  })

  it('does not fire when the applied payload carries no milestones', async () => {
    const apply = makeApplyPayload(() => {}, () => {})
    const events = await withRestoredEvents(() => apply(payloadWith([])))

    expect(events).toEqual([])
    expect((await dbGetAll()).length).toBe(0)
  })
})
