// GLANCEvault intents transport — SEND (always-encrypted deliverer) + RECEIVE
// (paginated drain, own cursor, uniform bounded-retry) + the cross-app key
// derivation contract. All deps (connection / fetch / key / cursor) are injected,
// so these run in the node env with no network and no IndexedDB.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  deriveIntentsRootKey,
  deriveEnvelopeKey,
  buildEncryptedEnvelope,
  buildEnvelope,
  buildIntentRow,
  parseIntentRow,
  parseEncryptedEnvelope,
  SOURCE_APPS,
  ACTIONS,
} from '@glance-apps/intents'
import {
  deliverToVault,
  drainVaultIntents,
  KeyUnavailableError,
  isVaultIntentsEnabled,
  readVaultIntentsConnection,
  MAX_INTENT_RETRIES,
} from './intentsVaultTransport.js'
import { makeDeriveFn } from './intentsKeyStore.js'

// localStorage shim for the enabled-gate tests.
if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map()
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  }
}

const SALT = new Uint8Array(16).fill(7)
const CONN = { vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acct-1' }

const notifyIntent = (id = '20260101T000000Z-aaaaaa') => ({
  event_id: id,
  emitted_by: SOURCE_APPS.LIFEGLANCE,
  action: ACTIONS.NOTIFY,
  payload: {
    event_id: id, source_app: SOURCE_APPS.LIFEGLANCE, source_entity_id: 'm1',
    entity_type: 'goal', event: 'completed', task_id: 'm1', title: 'Ship it',
    timestamp: '2026-01-01T00:00:00.000Z',
  },
})

// Build a full server row (adds seq + serverMtime to a codec-built row).
async function encRow(rootKey, { seq, emittedBy = SOURCE_APPS.DAYGLANCE, eventId, event = 'completed' }) {
  const env = await buildEncryptedEnvelope(
    { action: ACTIONS.NOTIFY, emittedBy, eventId, payload: {
      event_id: eventId, source_app: SOURCE_APPS.LIFEGLANCE, source_entity_id: 'm1',
      entity_type: 'goal', event, task_id: 'm1', title: 'T', timestamp: '2026-01-01T00:00:00.000Z',
    } },
    s => deriveEnvelopeKey(rootKey, s),
  )
  const row = buildIntentRow(env, { ttlMs: 60000 })
  return { eventId: row.eventId, envelope: row.envelope, expiresAt: row.expiresAt, seq, serverMtime: '2026-01-01T00:00:00.000Z' }
}

async function plainRow({ seq, eventId }) {
  const env = buildEnvelope({ action: ACTIONS.NOTIFY, emittedBy: SOURCE_APPS.DAYGLANCE, eventId, payload: {
    event_id: eventId, source_app: SOURCE_APPS.LIFEGLANCE, source_entity_id: 'm1',
    entity_type: 'goal', event: 'completed', task_id: 'm1', title: 'T', timestamp: '2026-01-01T00:00:00.000Z',
  } })
  const row = buildIntentRow(env, { ttlMs: 60000 })
  return { eventId: row.eventId, envelope: row.envelope, expiresAt: row.expiresAt, seq, serverMtime: '2026-01-01T00:00:00.000Z' }
}

// One-page list fetch returning the given rows.
function listFetch(rows, hasMore = false) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rows, hasMore }) }))
}

function memCursor(start = null) {
  let cursor = start
  const retries = {}
  return {
    getCursor: () => cursor,
    setCursor: v => { cursor = v },
    bumpRetry: seq => { retries[seq] = (retries[seq] || 0) + 1; return retries[seq] },
    clearRetry: seq => { delete retries[seq] },
    get cursor() { return cursor },
    retries,
  }
}

// ── SEND: the always-encrypted vault deliverer ────────────────────────────────

describe('deliverToVault', () => {
  it('produces an ENCRYPTED row and POSTs it to /intents/batch', async () => {
    let captured
    const fetchImpl = async (url, init) => {
      captured = { url, method: init.method, body: JSON.parse(init.body) }
      return { ok: true, status: 200, json: async () => ({ written: 1, maxSeq: 1 }) }
    }
    const rootKey = await deriveIntentsRootKey('pw', SALT)
    const intent = notifyIntent()
    const res = await deliverToVault(intent, { connection: CONN, fetchImpl, getRootKey: async () => rootKey })

    expect(res).toBe('delivered')
    expect(captured.method).toBe('POST')
    expect(captured.url).toBe('https://vault.example/intents/batch')
    expect(captured.body.accountId).toBe('acct-1')
    const ev = captured.body.events[0]
    expect(ev.eventId).toBe(intent.event_id)       // stable id === idempotency key
    // Decode the wire envelope: it MUST be encrypted (no plaintext on the vault).
    const parsed = parseIntentRow({ ...ev, seq: 1, serverMtime: '2026-01-01T00:00:00.000Z' })
    expect(parsed.envelope.encrypted).toBe(true)
    expect(parsed.envelope.payload_ciphertext).toBeTruthy()
    expect(parsed.envelope.payload).toBeUndefined() // the payload is sealed
  })

  it('HOLDS (transient) when the vault key is absent — sends nothing, never plaintext', async () => {
    const fetchImpl = vi.fn()
    const res = await deliverToVault(notifyIntent(), { connection: CONN, fetchImpl, getRootKey: async () => null })
    expect(res).toBe('transient')
    expect(fetchImpl).not.toHaveBeenCalled()        // nothing built, nothing sent
  })

  it('is transient when the connection is not ready', async () => {
    const res = await deliverToVault(notifyIntent(), { connection: null, getRootKey: async () => 'k' })
    // readVaultIntentsConnection() falls back to localStorage (unset) → null → transient.
    expect(res).toBe('transient')
  })

  it('maps HTTP status: 5xx→transient, other 4xx→permanent, 2xx→delivered', async () => {
    const rootKey = await deriveIntentsRootKey('pw', SALT)
    const mk = status => async () => ({ ok: status < 400, status, json: async () => ({}) })
    const deps = s => ({ connection: CONN, fetchImpl: mk(s), getRootKey: async () => rootKey })
    expect(await deliverToVault(notifyIntent(), deps(200))).toBe('delivered')
    expect(await deliverToVault(notifyIntent(), deps(503))).toBe('transient')
    expect(await deliverToVault(notifyIntent(), deps(400))).toBe('permanent')
  })

  it('is transient on a network throw', async () => {
    const rootKey = await deriveIntentsRootKey('pw', SALT)
    const fetchImpl = async () => { throw new Error('offline') }
    expect(await deliverToVault(notifyIntent(), { connection: CONN, fetchImpl, getRootKey: async () => rootKey })).toBe('transient')
  })
})

// ── RECEIVE: the drain ────────────────────────────────────────────────────────

describe('drainVaultIntents', () => {
  it('decrypts + applies a row and advances the cursor to its seq', async () => {
    const rootKey = await deriveIntentsRootKey('pw', SALT)
    const row = await encRow(rootKey, { seq: 3, eventId: '20260101T000000Z-bbbbbb', event: 'completed' })
    const applied = []
    const cursor = memCursor()
    await drainVaultIntents(async env => applied.push(env), {
      connection: CONN, fetchImpl: listFetch([row]), getRootKey: async () => rootKey, cursorStore: cursor,
    })
    expect(applied).toHaveLength(1)
    expect(applied[0].action).toBe(ACTIONS.NOTIFY)
    expect(applied[0].payload.event).toBe('completed')
    expect(cursor.cursor).toBe('3')                 // advanced only to the consumed row
  })

  it('HOLDS on key-absent (transient) — does not drop, does not advance', async () => {
    const rootKey = await deriveIntentsRootKey('pw', SALT)
    const row = await encRow(rootKey, { seq: 5, eventId: '20260101T000000Z-cccccc' })
    const applied = []
    const cursor = memCursor()
    await drainVaultIntents(async env => applied.push(env), {
      connection: CONN, fetchImpl: listFetch([row]), getRootKey: async () => null, cursorStore: cursor,
    })
    expect(applied).toHaveLength(0)                  // held, not applied
    expect(cursor.cursor).toBeNull()                 // cursor NOT advanced (no loss)
    expect(cursor.retries[5]).toBe(1)                // bounded-retry counter bumped
  })

  it('gives up loudly + advances after MAX_INTENT_RETRIES key-absent holds', async () => {
    const rootKey = await deriveIntentsRootKey('pw', SALT)
    const row = await encRow(rootKey, { seq: 8, eventId: '20260101T000000Z-dddddd' })
    const cursor = memCursor()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < MAX_INTENT_RETRIES; i++) {
      await drainVaultIntents(async () => {}, {
        connection: CONN, fetchImpl: listFetch([row]), getRootKey: async () => null, cursorStore: cursor,
      })
    }
    expect(cursor.cursor).toBe('8')                  // gave up → advanced past so it can't wedge
    warn.mockRestore()
  })

  it('REJECTS a plaintext row over the vault (permanent) — never routes it, advances', async () => {
    const rootKey = await deriveIntentsRootKey('pw', SALT)
    const row = await plainRow({ seq: 4, eventId: '20260101T000000Z-eeeeee' })
    const applied = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cursor = memCursor()
    await drainVaultIntents(async env => applied.push(env), {
      connection: CONN, fetchImpl: listFetch([row]), getRootKey: async () => rootKey, cursorStore: cursor,
    })
    expect(applied).toHaveLength(0)                  // never routed
    expect(cursor.cursor).toBe('4')                  // permanent → advanced
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('advances the cursor ONLY over consumed rows across a page', async () => {
    const rootKey = await deriveIntentsRootKey('pw', SALT)
    const rows = [
      await encRow(rootKey, { seq: 10, eventId: '20260101T000000Z-1111aa' }),
      await encRow(rootKey, { seq: 11, eventId: '20260101T000000Z-2222bb' }),
    ]
    const cursor = memCursor('9')
    const applied = []
    await drainVaultIntents(async env => applied.push(env), {
      connection: CONN, fetchImpl: listFetch(rows), getRootKey: async () => rootKey, cursorStore: cursor,
    })
    expect(applied).toHaveLength(2)
    expect(cursor.cursor).toBe('11')
  })

  it('HOLDS when the handler throws (transient), not advancing past the failing row', async () => {
    const rootKey = await deriveIntentsRootKey('pw', SALT)
    const rows = [
      await encRow(rootKey, { seq: 1, eventId: '20260101T000000Z-aaaa11' }),
      await encRow(rootKey, { seq: 2, eventId: '20260101T000000Z-bbbb22' }),
    ]
    const cursor = memCursor()
    let n = 0
    await drainVaultIntents(async () => { n++; if (n === 2) throw new Error('handler boom') }, {
      connection: CONN, fetchImpl: listFetch(rows), getRootKey: async () => rootKey, cursorStore: cursor,
    })
    expect(cursor.cursor).toBe('1')                 // first consumed; held on the second
    expect(cursor.retries[2]).toBe(1)
  })

  it('skips loopback rows (our own emitted) but consumes them (advances)', async () => {
    const rootKey = await deriveIntentsRootKey('pw', SALT)
    const row = await encRow(rootKey, { seq: 7, emittedBy: SOURCE_APPS.LIFEGLANCE, eventId: '20260101T000000Z-self00' })
    const applied = []
    const cursor = memCursor()
    await drainVaultIntents(async env => applied.push(env), {
      connection: CONN, fetchImpl: listFetch([row]), getRootKey: async () => rootKey, cursorStore: cursor,
    })
    expect(applied).toHaveLength(0)                  // not re-applied to ourselves
    expect(cursor.cursor).toBe('7')                 // but consumed
  })

  it('does not advance the cursor on a transient list failure', async () => {
    const cursor = memCursor('2')
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) })
    await drainVaultIntents(async () => {}, { connection: CONN, fetchImpl, getRootKey: async () => 'k', cursorStore: cursor })
    expect(cursor.cursor).toBe('2')
  })
})

// ── Cross-app key derivation (byte-identical, mutually decryptable) ────────────

describe('cross-app key derivation', () => {
  it('an envelope encrypted in app A decrypts under app B derived from the same passphrase + salt', async () => {
    // App A ("dayGLANCE") encrypts with a key derived from (passphrase, vault salt).
    const rootA = await deriveIntentsRootKey('shared-passphrase', SALT)
    const env = await buildEncryptedEnvelope(
      { action: ACTIONS.CREATE, emittedBy: SOURCE_APPS.DAYGLANCE, eventId: '20260101T000000Z-x0x0x0',
        payload: { title: 'Run a marathon', source_app: SOURCE_APPS.DAYGLANCE, entity_type: 'goal' } },
      s => deriveEnvelopeKey(rootA, s),
    )
    const row = buildIntentRow(env, { ttlMs: 60000 })
    const parsed = parseIntentRow({ ...row, seq: 1, serverMtime: '2026-01-01T00:00:00.000Z' })

    // App B ("lifeGLANCE") derives independently from the SAME inputs → same key.
    const rootB = await deriveIntentsRootKey('shared-passphrase', SALT)
    const decoded = await parseEncryptedEnvelope(parsed.envelope, makeDeriveFn(rootB))
    expect(decoded.action).toBe(ACTIONS.CREATE)
    expect(decoded.payload.title).toBe('Run a marathon')
  })

  it('a DIFFERENT passphrase does NOT decrypt (isolation)', async () => {
    const rootA = await deriveIntentsRootKey('passphrase-A', SALT)
    const env = await buildEncryptedEnvelope(
      { action: ACTIONS.CREATE, emittedBy: SOURCE_APPS.DAYGLANCE, eventId: '20260101T000000Z-y0y0y0',
        payload: { title: 'secret', source_app: SOURCE_APPS.DAYGLANCE, entity_type: 'goal' } },
      s => deriveEnvelopeKey(rootA, s),
    )
    const row = buildIntentRow(env, { ttlMs: 60000 })
    const parsed = parseIntentRow({ ...row, seq: 1, serverMtime: '2026-01-01T00:00:00.000Z' })
    const rootWrong = await deriveIntentsRootKey('passphrase-B', SALT)
    await expect(parseEncryptedEnvelope(parsed.envelope, makeDeriveFn(rootWrong))).rejects.toThrow()
  })
})

// ── Enabled gate (opt-in alongside WebDAV, like sync) ─────────────────────────

describe('isVaultIntentsEnabled / readVaultIntentsConnection', () => {
  beforeEach(() => localStorage.clear())

  it('is off unless vault sync is explicitly enabled with all coordinates', () => {
    expect(isVaultIntentsEnabled()).toBe(false)
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify({ vaultUrl: 'u', vaultToken: 't', accountId: 'a' }))
    expect(isVaultIntentsEnabled()).toBe(false) // vaultEnabled not set → off
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify({ vaultEnabled: true, vaultUrl: 'u', vaultToken: 't', accountId: 'a' }))
    expect(isVaultIntentsEnabled()).toBe(true)
    expect(readVaultIntentsConnection()).toEqual({ vaultUrl: 'u', vaultToken: 't', accountId: 'a' })
  })
})
