// Durable outbox — the never-lose-an-intent machinery.
//
// Exercises the send-side invariants directly against an in-memory store:
//   • persist-before-transmit (enqueue is durable and stores the RAW intent);
//   • idempotent enqueue preserves in-flight delivery progress;
//   • per-target flush state machine (delivered / transient-retry / permanent);
//   • no loss — a transient target is HELD (retried) while another delivers;
//   • bounded give-up so a dead target can't grow the outbox unbounded.

import { describe, it, expect, beforeEach } from 'vitest'
import { enqueue, flush, pendingCount, list, MAX_OUTBOX_ATTEMPTS } from './intentsOutbox.js'

// A tiny in-memory store matching the injectable interface. Structured-clones on
// read (like IndexedDB) so a caller mutating a returned entry can't corrupt state.
function memStore() {
  const m = new Map()
  return {
    _m: m,
    async getAll() { return [...m.values()].map(e => structuredClone(e)) },
    async get(id) { const e = m.get(id); return e ? structuredClone(e) : undefined },
    async put(e) { m.set(e.id, structuredClone(e)) },
    async delete(id) { m.delete(id) },
  }
}

const rawIntent = (id = 'evt-1', over = {}) => ({
  event_id: id,
  emitted_by: 'app.lifeglance',
  action: 'notify',
  payload: { event_id: id, event: 'completed', title: 'T', ...over },
})

let store
beforeEach(() => { store = memStore() })

describe('enqueue', () => {
  it('persists the RAW intent with every target pending + attempts 0 (durable)', async () => {
    await enqueue(rawIntent(), ['webdav', 'vault'], { store })
    const entry = await store.get('evt-1')
    expect(entry.intent.action).toBe('notify')           // raw intent, not an envelope
    expect(entry.intent.payload.event).toBe('completed')
    expect(entry.targets).toEqual({ webdav: 'pending', vault: 'pending' })
    expect(entry.attempts).toEqual({ webdav: 0, vault: 0 })
    // No envelope / ciphertext ever written to disk.
    expect(JSON.stringify(entry)).not.toMatch(/encrypted|ciphertext|iv/)
  })

  it('throws on a missing event_id or empty targets', async () => {
    await expect(enqueue({ action: 'notify' }, ['vault'], { store })).rejects.toThrow(/event_id/)
    await expect(enqueue(rawIntent(), [], { store })).rejects.toThrow(/target/)
  })

  it('is idempotent on event_id and preserves in-flight progress', async () => {
    await enqueue(rawIntent(), ['webdav', 'vault'], { store })
    // Deliver only webdav.
    await flush({ webdav: async () => 'delivered' }, { store })
    expect((await store.get('evt-1')).targets.webdav).toBe('delivered')
    // Re-enqueue the same event_id: NO-OP — must not reset webdav to pending.
    await enqueue(rawIntent(), ['webdav', 'vault'], { store })
    expect((await store.get('evt-1')).targets.webdav).toBe('delivered')
  })
})

describe('flush state machine', () => {
  it('removes an entry once every target is delivered', async () => {
    await enqueue(rawIntent(), ['webdav', 'vault'], { store })
    const stats = await flush({ webdav: async () => 'delivered', vault: async () => 'delivered' }, { store })
    expect(stats.delivered).toBe(2)
    expect(stats.removed).toBe(1)
    expect(await store.get('evt-1')).toBeUndefined()
  })

  it('HOLDS a transient target while another delivers — no loss', async () => {
    await enqueue(rawIntent(), ['webdav', 'vault'], { store })
    // vault key absent → transient; webdav delivers.
    await flush({ webdav: async () => 'delivered', vault: async () => 'transient' }, { store })
    const entry = await store.get('evt-1')
    expect(entry).toBeDefined()                    // NOT dropped
    expect(entry.targets.webdav).toBe('delivered')
    expect(entry.targets.vault).toBe('pending')    // held for retry
    expect(entry.attempts.vault).toBe(1)
    // The key appears → next flush delivers vault and clears the entry.
    const stats = await flush({ webdav: async () => 'delivered', vault: async () => 'delivered' }, { store })
    expect(stats.removed).toBe(1)
    // An already-delivered target is never re-delivered.
    expect(stats.delivered).toBe(1)
    expect(await store.get('evt-1')).toBeUndefined()
  })

  it('treats a thrown deliverer as transient (never drops)', async () => {
    await enqueue(rawIntent(), ['vault'], { store })
    await flush({ vault: async () => { throw new Error('boom') } }, { store })
    const entry = await store.get('evt-1')
    expect(entry.targets.vault).toBe('pending')
    expect(entry.attempts.vault).toBe(1)
  })

  it('gives up a permanent target immediately', async () => {
    await enqueue(rawIntent(), ['webdav'], { store })
    const stats = await flush({ webdav: async () => 'permanent' }, { store })
    expect(stats.gaveUp).toBe(1)
    expect(stats.removed).toBe(1)                  // no pending target left
  })

  it('bounds transient retries at MAX_OUTBOX_ATTEMPTS then gives up', async () => {
    await enqueue(rawIntent(), ['vault'], { store })
    for (let i = 0; i < MAX_OUTBOX_ATTEMPTS - 1; i++) {
      await flush({ vault: async () => 'transient' }, { store })
      expect(await store.get('evt-1')).toBeDefined()
    }
    const stats = await flush({ vault: async () => 'transient' }, { store })
    expect(stats.gaveUp).toBe(1)
    expect(await store.get('evt-1')).toBeUndefined()
  })

  it('leaves a target untouched when no deliverer is supplied this flush', async () => {
    await enqueue(rawIntent(), ['webdav', 'vault'], { store })
    // Only webdav enabled this flush; vault has no deliverer.
    await flush({ webdav: async () => 'delivered' }, { store })
    const entry = await store.get('evt-1')
    expect(entry.targets.vault).toBe('pending')
    expect(entry.attempts.vault).toBe(0)           // not attempted, not counted
  })

  it('collapses a concurrent flush via the in-flight lock', async () => {
    await enqueue(rawIntent(), ['vault'], { store })
    let release
    const gate = new Promise(r => { release = r })
    const slow = flush({ vault: async () => { await gate; return 'delivered' } }, { store })
    const concurrent = await flush({ vault: async () => 'delivered' }, { store })
    expect(concurrent).toEqual({ skipped: true })
    release()
    await slow
  })
})

describe('pendingCount / list', () => {
  it('counts entries with ≥1 pending target', async () => {
    await enqueue(rawIntent('a'), ['webdav', 'vault'], { store })
    await enqueue(rawIntent('b'), ['webdav'], { store })
    await flush({ webdav: async () => 'delivered' }, { store }) // b done; a still has vault pending
    expect(await pendingCount({ store })).toBe(1)
    expect((await list({ store })).map(e => e.id)).toEqual(['a'])
  })
})
