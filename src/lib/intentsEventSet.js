// Intents over Direct Access: the event-set file (docs/direct-access.md, step 3).
//
// The WebDAV intents transport is built on a directory: one file per event,
// found by listing. An iPhone on Nextcloud, Drive or Dropbox holds bookmarks
// to files and cannot list a directory or create a file by name, so this
// transport is built on the one primitive every platform has, a single file,
// and is the same on Android and iPhone:
//
//   GLANCE/events/glance-events.json = { version: 1, writtenBy?, salt?, events: [envelope, …] }
//
// holding every live envelope, plaintext or encrypted exactly as the WebDAV
// transport builds them. The file is a SET keyed by event_id:
//
//   • The merge is a union that drops envelopes past retention, order-
//     independent and idempotent, so any two copies converge whichever order
//     they are merged in. A syncing tool's last-writer-wins on a collision
//     loses an append, and a conflicted copy is inert; the next merge repairs
//     both.
//   • A sender writes its own events and keeps them until they stick: the
//     ledger holds what this device emitted within retention, and a copy of
//     the file that lost one gets it back from here. Nobody re-adds another
//     device's events: the sender is the one responsible for them.
//   • A receiver reads, never writes for what it read: it handles the
//     envelopes above its cursor that it did not emit, and advances the
//     cursor, exactly as the directory loop does over a listing.
//   • The salt the encrypted envelopes' root key is derived from travels in
//     the header (intentsDirectAccessKey.js): once a file names one, every
//     writer keeps it, and a receiver derives its key from it.
//   • Garbage collection is the merge: expired envelopes fall out of the
//     union, and the device that drops them writes only under the relay rule
//     (the package's relayDecision, staggered by writer rank), so an idle
//     fleet does not take turns rewriting the file. A sender's own write
//     carries pending drops.
//
// This is lastGLANCE's src/intents/eventSet.ts (dayGLANCE's
// src/intents/folderIntents.js) with this app's name and keys. Everything
// here is pure over an injected transport (the `events` slot: by path on
// Android, a bookmarked file on iOS) and storage; the app-side wiring is
// intentsDirectAccessTransport.js and the poller.

import {
  parseEnvelope, parseEncryptedEnvelope, deriveEnvelopeKey, SOURCE_APPS,
  NoKeyError, WrongKeyError, NotEncryptedError, MalformedEnvelopeError,
} from '@glance-apps/intents'
import { classifySnapshotText, relayDecision, relayWaitMs, noteWriter } from '@glance-apps/sync'
import { loadIntentsRootKey } from './intentsKeyStore.js'

export const EVENTS_FILENAME = 'glance-events.json'
export const DEFAULT_EVENTS_PATH = '/GLANCE/events/'
export const DEFAULT_RETENTION_DAYS = 30
const ONE_DAY_MS = 24 * 60 * 60 * 1000
export const DEFAULT_RETENTION_MS = DEFAULT_RETENTION_DAYS * ONE_DAY_MS
/** This app, as envelopes name it: its own events are never handled. */
export const SELF = SOURCE_APPS.LIFEGLANCE
/** Per-transport cursor (the WebDAV loop keeps its own). */
export const DIRECT_ACCESS_INTENT_CURSOR_KEY = 'lifeglance-direct-access-intents-cursor'
/** The sender ledger: { [event_id]: envelope } this device emitted, within retention. */
export const DIRECT_ACCESS_INTENT_LEDGER_KEY = 'lifeglance-direct-access-intents-ledger'

const defaultStorage = () => (typeof localStorage === 'undefined' ? null : localStorage)

/** 'GLANCE/events/glance-events.json', relative to the folder, from the WebDAV-style events directory. */
export const relativeEventsPath = (eventsPath) =>
  `${(eventsPath ?? DEFAULT_EVENTS_PATH).replace(/^\/+/, '').replace(/\/+$/, '')}/${EVENTS_FILENAME}`

// ─── the set ─────────────────────────────────────────────────────────────────

/** When an envelope was emitted: its stamp, else the timestamp its id starts with; null when neither parses. */
export function eventTime(envelope) {
  const stamp = Date.parse(envelope?.emitted_at ?? '')
  if (Number.isFinite(stamp)) return stamp
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(envelope?.event_id ?? '')
  if (!m) return null
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
  return Number.isFinite(t) ? t : null
}

export const isLive = (envelope, now, retentionMs) => {
  const t = eventTime(envelope)
  return t !== null && now - t <= retentionMs
}

/**
 * The union of two sets, keyed by event_id, without expired envelopes, in id
 * order. Order-independent and idempotent. Copies of one id are the same
 * envelope (ids are unique at emit), so the first seen is kept.
 */
export function mergeEventSets(a, b, { now, retentionMs }) {
  const byId = new Map()
  for (const e of [...(a ?? []), ...(b ?? [])]) {
    if (!e || typeof e !== 'object' || typeof e.event_id !== 'string') continue
    if (!isLive(e, now, retentionMs)) continue
    if (!byId.has(e.event_id)) byId.set(e.event_id, e)
  }
  return [...byId.values()].sort((x, y) => x.event_id.localeCompare(y.event_id))
}

/** What a write would change: the ids, in order. */
export const eventSetKey = (events) => events.map((e) => e.event_id).join('\n')
export const serializeEventSet = (events, writtenBy = null, salt = null) =>
  JSON.stringify({ version: 1, ...(writtenBy ? { writtenBy } : {}), ...(salt ? { salt } : {}), events })

/**
 * The file's text as the cycle reads it: the snapshot classification plus
 * { kind: 'set', events, writtenBy, salt }, or 'no-data' for JSON that is not a set.
 */
export function parseEventSetText(text) {
  const read = classifySnapshotText(text)
  if (read.kind === 'error') return { kind: 'error', error: read.error ?? 'unavailable' }
  if (read.kind !== 'snapshot') return { kind: read.kind }
  const events = read.remote?.events
  if (!Array.isArray(events)) return { kind: 'no-data' }
  return {
    kind: 'set',
    events,
    writtenBy: typeof read.remote?.writtenBy === 'string' ? read.remote.writtenBy : null,
    salt: typeof read.remote?.salt === 'string' && read.remote.salt ? read.remote.salt : null,
  }
}

// ─── the ledger and the cursor ───────────────────────────────────────────────

export function readLedger(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(DIRECT_ACCESS_INTENT_LEDGER_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function writeLedger(ledger, storage = defaultStorage()) {
  try {
    if (Object.keys(ledger).length === 0) storage?.removeItem(DIRECT_ACCESS_INTENT_LEDGER_KEY)
    else storage?.setItem(DIRECT_ACCESS_INTENT_LEDGER_KEY, JSON.stringify(ledger))
  } catch { /* storage unavailable: the outbox still holds the intent */ }
}

/** Records an envelope this device emitted. Idempotent by event_id. */
export function ledgerAppend(envelope, storage = defaultStorage()) {
  if (!envelope || typeof envelope.event_id !== 'string') return
  const ledger = readLedger(storage)
  if (!ledger[envelope.event_id]) {
    ledger[envelope.event_id] = envelope
    writeLedger(ledger, storage)
  }
}

/** The live ledger entries, in id order; expired ones are pruned on the way. */
export function ledgerLive(storage, now, retentionMs) {
  const ledger = readLedger(storage)
  const live = {}
  let pruned = false
  for (const [id, e] of Object.entries(ledger)) {
    if (isLive(e, now, retentionMs)) live[id] = e
    else pruned = true
  }
  if (pruned) writeLedger(live, storage)
  return Object.values(live).sort((x, y) => x.event_id.localeCompare(y.event_id))
}

export const getCursor = (storage) => { try { return storage?.getItem(DIRECT_ACCESS_INTENT_CURSOR_KEY) || null } catch { return null } }
export const setCursor = (storage, id) => { try { storage?.setItem(DIRECT_ACCESS_INTENT_CURSOR_KEY, id) } catch { /* ignore */ } }

// ─── receiving one envelope ──────────────────────────────────────────────────

/**
 * Handles one raw envelope from the set the way the WebDAV loop handles one
 * file: never this app's own; an encrypted one through the key for the salt
 * the set names, then the WebDAV intents root key as the fallback (neither:
 * logged, skipped as 'no_root_key'); then the app's handler. Never throws
 * for a bad envelope: the cycle advances the cursor past it either way.
 *
 * @param {object} raw
 * @param {object} deps
 * @param {(envelope: object) => Promise<void>} deps.handleEnvelope
 * @param {string | null} [deps.salt] the salt the event set names
 * @param {(saltB64: string) => Promise<CryptoKey | null>} [deps.loadKeyForSalt]
 * @param {() => Promise<CryptoKey | null>} [deps.loadKey] the WebDAV intents root key
 * @param {{ warn: Function }} [deps.log]
 * @returns {Promise<{ handled: true } | { handled: false, skipped: string }>}
 */
export async function receiveEnvelope(raw, deps) {
  const loadLegacyKey = deps.loadKey ?? loadIntentsRootKey
  const loadKey = async () =>
    (deps.salt && deps.loadKeyForSalt ? await deps.loadKeyForSalt(deps.salt) : null) ?? await loadLegacyKey()
  const log = deps.log ?? console
  if (raw?.emitted_by === SELF) return { handled: false, skipped: 'own' }

  let envelope
  try {
    if (raw?.encrypted === true) {
      const rootKey = await loadKey()
      if (!rootKey) {
        log.warn(`[intents/direct-access] encrypted intent ${raw.event_id} received but no key for it on this device (no_root_key)`)
        return { handled: false, skipped: 'no_root_key' }
      }
      envelope = await parseEncryptedEnvelope(raw, (salt) => deriveEnvelopeKey(rootKey, salt))
    } else {
      envelope = parseEnvelope(raw)
    }
  } catch (err) {
    let skipped = 'parse_error'
    if (err instanceof NoKeyError) skipped = 'NoKeyError'
    else if (err instanceof WrongKeyError) skipped = 'WrongKeyError'
    else if (err instanceof NotEncryptedError) skipped = 'NotEncryptedError'
    else if (err instanceof MalformedEnvelopeError) skipped = 'MalformedEnvelopeError'
    log.warn(`[intents/direct-access] skipping envelope ${raw?.event_id} (${skipped}):`, err?.message ?? err)
    return { handled: false, skipped }
  }

  if (envelope.emitted_by === SELF) return { handled: false, skipped: 'own' }
  await deps.handleEnvelope(envelope)
  return { handled: true }
}

// ─── the cycle ───────────────────────────────────────────────────────────────

/**
 * One cycle over the event-set file: read, merge (file ∪ this device's
 * ledger, minus expired), receive what is new and not ours, write when the
 * merged set differs from the file and the write is this device's to make
 * (an event of its own the file lacks goes out now; anything else, which can
 * only be a drop, waits for the relay rule).
 *
 * @param {object} args
 * @param {object} args.transport the events slot and the relay bookkeeping names
 * @param {object} [args.io]
 * @param {Storage | null} [args.io.storage]
 * @param {number} [args.io.retentionMs]
 * @param {string | null} [args.io.eventsPath] the WebDAV-style events directory ('/GLANCE/events/')
 * @param {(raw: object, meta: { salt: string | null }) => Promise<unknown>} [args.io.receive] absent: a sender-only cycle, no cursor moves
 * @param {string | null} [args.io.salt] the salt a sender brings when the file names none; the file's own always wins
 * @param {string | (() => string)} [args.io.deviceId] stamped as writtenBy; ranks this device's relay
 * @param {string} [args.io.writersKey] where the writers seen are kept (default: the snapshot cycle's key, so the fleet is ranked once)
 * @param {() => number} [args.io.now]
 * @param {{ warn: Function, error: Function }} [args.io.log]
 * @param {{ lastWriteAt: number, pendingWrite: object | null } | null} [args.state]
 */
export async function runEventSetCycle({ transport, io = {}, state }) {
  const now = io.now ?? Date.now
  const log = io.log ?? console
  const storage = io.storage ?? defaultStorage()
  const retentionMs = io.retentionMs ?? DEFAULT_RETENTION_MS
  const next = { lastWriteAt: state?.lastWriteAt ?? 0, pendingWrite: state?.pendingWrite ?? null }
  if (!transport?.events?.supported()) return { state: next, outcome: { kind: 'skipped', reason: 'unsupported' } }

  const relPath = relativeEventsPath(io.eventsPath)
  const read = parseEventSetText(await transport.events.read(relPath))
  if (read.kind === 'error') return { state: next, outcome: { kind: 'error', reason: 'unavailable', error: read.error } }
  if (read.kind !== 'set' && read.kind !== 'absent') return { state: next, outcome: { kind: 'skipped', reason: read.kind } }
  const fileEvents = read.kind === 'set' ? read.events : []
  const salt = (read.kind === 'set' && read.salt) || io.salt || null
  const deviceId = (() => {
    try { const v = typeof io.deviceId === 'function' ? io.deviceId() : io.deviceId; return typeof v === 'string' && v ? v : null }
    catch { return null }
  })()
  const writersKey = io.writersKey ?? `${transport.lastSyncedKey ?? transport.id ?? 'direct-access'}:writers`
  if (read.kind === 'set' && read.writtenBy !== deviceId && storage) noteWriter(storage, writersKey, read.writtenBy)

  const own = ledgerLive(storage, now(), retentionMs)
  const merged = mergeEventSets(fileEvents, own, { now: now(), retentionMs })
  const fileIds = new Set(fileEvents.map((e) => e?.event_id))

  // Receive: above the cursor, not ours, in id order; the cursor moves past
  // every envelope looked at, handled or not, as the directory loop does.
  // An encrypted envelope this device has no key for is NOT skipped past: the
  // cursor stops in front of it and the caller is told a key is needed, so the
  // event is handled once the passphrase has been entered rather than lost.
  let received = 0
  let keyNeeded = false
  if (typeof io.receive === 'function') {
    const cursor = getCursor(storage)
    for (const e of merged) {
      if (cursor && e.event_id <= cursor) continue
      if (e.emitted_by !== SELF) {
        let r = null
        try { r = await io.receive(e, { salt }); received++ }
        catch (err) { log.warn(`[${transport.id ?? 'direct-access'}] intent handling failed:`, err?.message ?? err) }
        if (r && r.handled === false && r.skipped === 'no_root_key') { keyNeeded = true; received--; break }
      }
      setCursor(storage, e.event_id)
    }
  }

  // Write: own additions now; drops under the relay rule.
  const fileKey = eventSetKey(fileEvents.filter((e) => e && typeof e.event_id === 'string'))
  const mergedKey = eventSetKey(merged)
  const changed = mergedKey !== fileKey
  const ownMissing = own.some((e) => !fileIds.has(e.event_id))
  const confirmed = own.filter((e) => fileIds.has(e.event_id)).map((e) => e.event_id)
  const throttledWrite = async () => {
    if (now() - next.lastWriteAt < (transport.writeThrottleMs ?? 0)) return false
    next.lastWriteAt = now()
    const ok = await transport.events.write(relPath, serializeEventSet(merged, deviceId, salt))
    if (!ok) log.error(`[${transport.id ?? 'direct-access'}] event set write failed`)
    return ok
  }
  let wrote = false
  let deferred = false
  if (changed && ownMissing) {
    wrote = await throttledWrite()
    next.pendingWrite = null
  } else if (changed) {
    const waitMs = storage ? relayWaitMs(storage, writersKey, deviceId) : undefined
    const decision = relayDecision(next.pendingWrite, `${fileKey}\u0000${mergedKey}`, now(), waitMs)
    next.pendingWrite = decision.pending
    if (decision.write) wrote = await throttledWrite()
    else deferred = true
  } else {
    next.pendingWrite = null
  }
  const dropped = fileEvents.length - merged.filter((e) => fileIds.has(e.event_id)).length
  return { state: next, outcome: { kind: 'merged', received, wrote, deferred, own: ownMissing, confirmed, dropped, salt, keyNeeded } }
}

// One cycle at a time per process: the deliverer's sender cycle and the
// poller's receive cycle both read and write the same file. The union makes
// an interleaving safe (a lost append is re-added from the ledger), but
// serialising them spares the collision.
let chain = Promise.resolve()
export function withEventsLock(fn) {
  const run = chain.then(fn, fn)
  chain = run.then(() => undefined, () => undefined)
  return run
}

/**
 * The deliverer's half: record the envelope in this device's ledger, run a
 * sender-only cycle (no receive), and report whether the file holds the event
 * once read back. The ledger keeps it until retention either way.
 */
export async function publishOwnEvent(transport, envelope, io = {}) {
  const storage = io.storage ?? defaultStorage()
  ledgerAppend(envelope, storage)
  return withEventsLock(async () => {
    const { outcome } = await runEventSetCycle({ transport, io: { ...io, storage, receive: undefined }, state: io.state ?? { lastWriteAt: 0, pendingWrite: null } })
    if (outcome.kind !== 'merged') return false
    if (outcome.confirmed.includes(envelope.event_id)) return true
    if (!outcome.wrote) return false
    const back = parseEventSetText(await transport.events.read(relativeEventsPath(io.eventsPath)))
    return back.kind === 'set' && back.events.some((e) => e?.event_id === envelope.event_id)
  })
}
