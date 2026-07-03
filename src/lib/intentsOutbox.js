// =============================================================================
// intentsOutbox — the durable outbound queue (never-lose-an-intent machinery)
// =============================================================================
//
// A self-contained module that persists outbound intents and drives their
// delivery across one-or-more transports (webdav, vault). It imports NOTHING
// from the emit sites, the live transports, or @glance-apps/* — it depends only
// on a persistent store and a set of injected deliverer functions. That keeps it
// testable in isolation and keeps the wire format (envelopes/crypto) out of the
// queue entirely.
//
// HARD RULE — the outbox stores the RAW intent ({ event_id, action, payload,
// emitted_by }), NEVER a built envelope. Envelope construction + encryption
// happen inside the deliverer at flush time, so a plaintext envelope is never
// written to disk (structural, not a convention).
//
// Mirrors dayGLANCE's outbox shape so the send-side semantics are identical
// across apps (see docs/glance-intents-transport-reference.md §2).
// =============================================================================

const DB_NAME    = 'lifeglance-intents-outbox'
const STORE_NAME = 'entries'

// Deliberately far above the receive-side bound (5). Losing outbound data is
// worse than re-attempting, and the server is insert-only / idempotent on
// eventId, so a re-POST of an already-delivered row is a cheap no-op. The bound
// exists only so a genuinely-dead target can't grow the outbox unbounded.
export const MAX_OUTBOX_ATTEMPTS = 50

// ── IndexedDB store (one DB + one object store keyed on entry.id) ─────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
  })
}

// The store is abstracted behind a tiny interface so it is injectable for tests.
// IndexedDB structured-clones on read, so callers own/mutate what getAll returns.
export function makeIdbStore() {
  return {
    async getAll() {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
        req.onsuccess = e => resolve(e.target.result ?? [])
        req.onerror   = e => reject(e.target.error)
      })
    },
    async get(id) {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
        req.onsuccess = e => resolve(e.target.result ?? undefined)
        req.onerror   = e => reject(e.target.error)
      })
    },
    async put(entry) {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).put(entry)
        tx.oncomplete = () => resolve()
        tx.onerror    = e => reject(e.target.error)
      })
    },
    async delete(id) {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).delete(id)
        tx.oncomplete = () => resolve()
        tx.onerror    = e => reject(e.target.error)
      })
    },
  }
}

let _defaultStore = null
function defaultStore() {
  if (!_defaultStore) _defaultStore = makeIdbStore()
  return _defaultStore
}

// ── Entry helpers ────────────────────────────────────────────────────────────

function newEntry(intent, targets) {
  const entry = { id: intent.event_id, intent, createdAt: nowMs(), targets: {}, attempts: {} }
  for (const t of targets) { entry.targets[t] = 'pending'; entry.attempts[t] = 0 }
  return entry
}

// A separate seam so tests can freeze time if they ever need to; the value is
// only diagnostic metadata (never used for ordering or the wire).
function nowMs() { return Date.now() }

function isEntryDone(entry) {
  return Object.values(entry.targets).every(s => s !== 'pending')
}

// ── API ──────────────────────────────────────────────────────────────────────

/**
 * Persist a new outbox entry with every target 'pending'. DURABLE before it
 * resolves (the store write has completed). IDEMPOTENT on intent.event_id: if an
 * entry with that id already exists it is a NO-OP returning the existing entry
 * unchanged — re-emitting never resets in-flight delivery progress, and the
 * stable event_id makes a server re-POST a no-op too.
 *
 * @throws if intent.event_id is missing or targets is empty.
 */
export async function enqueue(intent, targets, opts = {}) {
  if (!intent || !intent.event_id) throw new Error('[outbox] intent.event_id is required')
  if (!Array.isArray(targets) || targets.length === 0) throw new Error('[outbox] at least one target is required')
  const store = opts.store ?? defaultStore()

  const existing = await store.get(intent.event_id)
  if (existing) return existing

  const entry = newEntry(intent, targets)
  await store.put(entry)
  return entry
}

let _flushing = false

/**
 * For each entry, for each STILL-'pending' target, call deliverers[target](intent)
 * and apply the result. An entry is removed once no target is 'pending'. Guarded
 * by an in-flight lock: a flush already running makes a concurrent call a no-op.
 *
 * @param deliverers { [transportName]: async (intent) => 'delivered'|'transient'|'permanent' }
 */
export async function flush(deliverers, opts = {}) {
  if (_flushing) return { skipped: true }
  _flushing = true
  const store = opts.store ?? defaultStore()
  const stats = { attempted: 0, delivered: 0, gaveUp: 0, removed: 0 }
  try {
    const entries = await store.getAll()
    for (const entry of entries) {
      let mutated = false
      for (const target of Object.keys(entry.targets)) {
        if (entry.targets[target] !== 'pending') continue
        const deliver = deliverers[target]
        if (typeof deliver !== 'function') continue // no deliverer supplied → untouched
        stats.attempted += 1

        let result
        try {
          result = await deliver(entry.intent)
        } catch {
          result = 'transient' // an unexpected throw never drops the intent
        }

        if (result === 'delivered') {
          entry.targets[target] = 'delivered'
          stats.delivered += 1
        } else if (result === 'permanent') {
          entry.targets[target] = 'given-up'
          stats.gaveUp += 1
          console.warn(`[outbox] target ${target} PERMANENTLY gave up on intent ${entry.id} (${entry.intent.action})`)
        } else {
          // 'transient' (or any unknown result) → retry, bump the per-target count.
          entry.attempts[target] = (entry.attempts[target] ?? 0) + 1
          if (entry.attempts[target] >= MAX_OUTBOX_ATTEMPTS) {
            entry.targets[target] = 'given-up'
            stats.gaveUp += 1
            console.warn(`[outbox] target ${target} gave up on intent ${entry.id} after ${entry.attempts[target]} attempts (${entry.intent.action})`)
          }
        }
        mutated = true
      }

      if (isEntryDone(entry)) {
        await store.delete(entry.id)
        stats.removed += 1
      } else if (mutated) {
        await store.put(entry)
      }
    }
  } finally {
    _flushing = false
  }
  return stats
}

/** Entries with ≥1 still-pending target. */
export async function pendingCount(opts = {}) {
  const store = opts.store ?? defaultStore()
  const entries = await store.getAll()
  return entries.filter(e => Object.values(e.targets).some(s => s === 'pending')).length
}

/** All entries (diagnostics / tests). */
export async function list(opts = {}) {
  const store = opts.store ?? defaultStore()
  return store.getAll()
}
