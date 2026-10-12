import { describe, it, expect, beforeEach } from 'vitest'
import { markLocalEdit, lastLocalEditAt, withoutLocalEditStamp, LOCAL_EDIT_KEY } from './localEditStamp.js'
import { markDirty, registerDirtyTarget } from './dirty.js'

// The suite runs under node: a Map-backed localStorage, like the engine tests use.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
  clear: () => { store.clear() },
}

describe('the local-edit stamp', () => {
  beforeEach(() => { localStorage.clear(); registerDirtyTarget(null) })

  it('is set by markDirty with or without a vault target', () => {
    expect(lastLocalEditAt()).toBeNull()
    markDirty('m1')
    expect(lastLocalEditAt()).toBeTruthy()
    localStorage.removeItem(LOCAL_EDIT_KEY)
    const seen = []
    registerDirtyTarget({ markDirty: (id) => seen.push(id) })
    markDirty('m2')
    expect(seen).toEqual(['m2'])
    expect(lastLocalEditAt()).toBeTruthy()
  })

  it('is not set by a write made inside an apply, and a later edit still stamps', async () => {
    const apply = withoutLocalEditStamp(async () => { markDirty('from-remote') })
    await apply()
    expect(lastLocalEditAt()).toBeNull()
    markLocalEdit(() => Date.parse('2026-10-12T00:00:00.000Z'))
    expect(lastLocalEditAt()).toBe('2026-10-12T00:00:00.000Z')
  })

  it('an apply that throws releases the hold', async () => {
    const apply = withoutLocalEditStamp(async () => { throw new Error('boom') })
    await expect(apply()).rejects.toThrow('boom')
    markDirty('m3')
    expect(lastLocalEditAt()).toBeTruthy()
  })
})
