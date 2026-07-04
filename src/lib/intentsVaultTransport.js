// =============================================================================
// intentsVaultTransport — GLANCEvault transport for @glance-apps/intents
// =============================================================================
//
// The vault-tier sibling of intentsTransport.js (WebDAV). It owns three things:
//   1. a thin HTTP client for the vault intents endpoints (/intents/batch,
//      /intents/list) — a client of the shared GLANCEvault API, reusing the SAME
//      connection ({ vaultUrl, vaultToken, accountId }) and native-safe fetch the
//      sync + blob transports use;
//   2. the ALWAYS-ENCRYPTED vault deliverer the outbox calls at flush time;
//   3. the receive drain (paginated list → decode → route) with its own cursor
//      and a uniform bounded-retry model.
//
// CROSS-APP CRYPTO CONTRACT: the vault intents key is the SAME per-account root
// key the blob store uses — loadVaultIntentsRootKey() (the dedicated 'vault-root-key'
// slot), derived deriveIntentsRootKey(syncPassphrase, /salt/:accountId) and now
// reliably bootstrapped on every setup path (dbSync.js). Two GLANCE apps that feed the
// same passphrase + the same server-owned vault salt derive the byte-identical
// key and decrypt each other's envelopes. NEVER plaintext on the vault, send or
// receive. See docs/glance-intents-transport-reference.md §3–§5.
// =============================================================================

import {
  buildEncryptedEnvelope,
  buildIntentRow,
  parseIntentRow,
  parseEncryptedEnvelope,
  parseSince,
  formatSince,
  SOURCE_APPS,
} from '@glance-apps/intents'
import { loadVaultIntentsRootKey, makeDeriveFn } from './intentsKeyStore.js'
import { nativeVaultFetchImpl } from '../sync/nativeVaultFetch.js'

const SYNC_CONFIG_KEY = 'lifeglance-cloud-sync-config'
const VAULT_CURSOR_KEY  = 'lifeglance-intents-vault-cursor'
const VAULT_RETRIES_KEY = 'lifeglance-intents-vault-retries'

/** Server page size for /intents/list. A backlog larger than this spans pages. */
export const PAGE_SIZE = 500
/** Default intents TTL: 30 days. A default, not part of the wire contract. */
export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000
/**
 * Receive-side bound for TRANSIENT failures only (network / server / a throwing
 * handler): generous, because dropping recoverable data on a blip is the cardinal
 * sin of a sync system. KEY-UNAVAILABLE never counts toward this — a row that can't
 * decrypt only because the vault-intents key isn't loaded yet is valid data merely
 * locked, so it HOLDS indefinitely and processes the moment the key arrives.
 */
export const MAX_TRANSIENT_RETRIES = 50

// ── Connection + fetch resolution (mirrors blobTransport) ─────────────────────

/**
 * Read the GLANCEvault connection from lifeGLANCE's sync config (reused by the
 * vault intents transport — that's also where the encryption key is established).
 * Requires vault sync to be configured (vaultEnabled + all three coordinates);
 * returns null otherwise. Whether the vault is the SELECTED intents transport is
 * decided by the intents config in intentsTransport.js (isVaultIntentsActive),
 * NOT here — this only reports connection availability.
 */
export function readVaultIntentsConnection() {
  let cfg
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY)
    cfg = raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
  if (!cfg || cfg.vaultEnabled !== true) return null
  const vaultUrl   = typeof cfg.vaultUrl   === 'string' ? cfg.vaultUrl.trim()   : ''
  const vaultToken = typeof cfg.vaultToken === 'string' ? cfg.vaultToken.trim() : ''
  const accountId  = typeof cfg.accountId  === 'string' ? cfg.accountId.trim()  : ''
  if (!vaultUrl || !vaultToken || !accountId) return null
  return { vaultUrl, vaultToken, accountId }
}

function resolveFetch(deps) {
  // On native, route through CapacitorHttp (the WebView CORS-blocks the vault);
  // on web this is undefined and we fall back to global fetch. Same native-safe
  // adapter the sync vault client and blob transport use.
  const f = deps.fetchImpl ?? nativeVaultFetchImpl() ?? globalThis.fetch
  if (typeof f !== 'function') throw new Error('intentsVaultTransport: no fetch implementation available')
  return f
}

async function vaultRequest(conn, doFetch, method, path, opts = {}) {
  let url = conn.vaultUrl.replace(/\/+$/, '') + path
  if (opts.query) {
    const qs = new URLSearchParams(opts.query).toString()
    if (qs) url += `?${qs}`
  }
  const init = { method, headers: { Authorization: `Bearer ${conn.vaultToken}`, ...opts.headers } }
  if (opts.jsonBody !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(opts.jsonBody)
  }
  return doFetch(url, init)
}

// 2xx → delivered; 5xx/429/408 (+ network throw, handled by caller) → transient;
// other 4xx → permanent. Shared by the deliverer.
function mapHttpStatus(status) {
  if (status >= 200 && status < 300) return 'delivered'
  if (status >= 500 || status === 429 || status === 408) return 'transient'
  return 'permanent'
}

// ── Envelope params (uniform across deliverers) ───────────────────────────────

// The raw intent's event_id is carried through so the row id is STABLE across
// retries (outbox id === envelope event_id === server idempotency key).
function toEnvelopeParams(intent) {
  return {
    action:    intent.action,
    payload:   intent.payload,
    emittedBy: intent.emitted_by,
    eventId:   intent.event_id,
  }
}

// ── The vault deliverer — ALWAYS ENCRYPTED (no plaintext branch, ever) ────────

/**
 * Deliver one raw intent to the vault. Returns 'delivered' | 'transient' |
 * 'permanent' — never throws to signal an expected failure (an unexpected throw
 * is caught by the outbox and treated as transient, so nothing is ever dropped).
 *
 *   • connection not ready → 'transient' (it may appear; never drop)
 *   • vault intents key absent → 'transient' — build nothing, send nothing. The
 *     outbox holds the intent until key setup runs. NEVER plaintext.
 *   • otherwise: build an ENCRYPTED envelope, POST one batch, map the status.
 */
export async function deliverToVault(intent, deps = {}) {
  const conn = deps.connection ?? readVaultIntentsConnection()
  if (!conn) return 'transient'

  const getRootKey = deps.getRootKey ?? loadVaultIntentsRootKey
  const rootKey = await getRootKey()
  if (!rootKey) return 'transient' // key not ready — hold/retry, never plaintext

  const deriveFn = makeDeriveFn(rootKey)
  const envelope = await buildEncryptedEnvelope(toEnvelopeParams(intent), deriveFn)
  const row = buildIntentRow(envelope, { ttlMs: deps.ttlMs ?? DEFAULT_TTL_MS })
  const body = {
    accountId: conn.accountId,
    events: [{ eventId: row.eventId, envelope: row.envelope, expiresAt: row.expiresAt }],
  }

  let res
  try {
    res = await vaultRequest(conn, resolveFetch(deps), 'POST', '/intents/batch', { jsonBody: body })
  } catch {
    return 'transient' // network error — retry next flush
  }
  return mapHttpStatus(res.status)
}

/** Bind a vault deliverer to a set of deps (connection/fetch/key/ttl injectable). */
export function makeVaultDeliverer(deps = {}) {
  return (intent) => deliverToVault(intent, deps)
}

// ── The receive drain ─────────────────────────────────────────────────────────

/**
 * The vault intents key is absent. A pure HOLD condition, never a drop: the key
 * arrives once setup / unlock / migration completes, so the row waits indefinitely
 * and is NEVER counted toward give-up or advanced past. routeRow signals this with
 * the 'hold-key' outcome; this typed marker remains for callers that prefer to
 * throw/catch the condition explicitly.
 */
export class KeyUnavailableError extends Error {
  constructor(message = 'vault intents key not available on this device') {
    super(message)
    this.name = 'KeyUnavailableError'
  }
}

// localStorage-backed cursor + per-seq retry counters. Injectable for tests.
function makeLocalStorageCursorStore() {
  const readRetries = () => {
    try { return JSON.parse(localStorage.getItem(VAULT_RETRIES_KEY) || '{}') || {} } catch { return {} }
  }
  const writeRetries = (m) => {
    try { localStorage.setItem(VAULT_RETRIES_KEY, JSON.stringify(m)) } catch { /* quota — non-fatal */ }
  }
  return {
    getCursor: () => { try { return localStorage.getItem(VAULT_CURSOR_KEY) } catch { return null } },
    setCursor: (v) => { try { localStorage.setItem(VAULT_CURSOR_KEY, v) } catch { /* non-fatal */ } },
    bumpRetry: (seq) => { const m = readRetries(); m[seq] = (m[seq] || 0) + 1; writeRetries(m); return m[seq] },
    clearRetry: (seq) => { const m = readRetries(); if (seq in m) { delete m[seq]; writeRetries(m) } },
  }
}

/**
 * Classify one decoded server row into exactly one of four outcomes. The whole
 * point is that a locked row is NOT a lost row:
 *
 *   'ok'        — consumed (decoded + applied, or a skipped loopback). Advance.
 *   'hold-key'  — KEY-UNAVAILABLE: the vault-intents key isn't loaded yet. VALID
 *                 data, merely locked; it decrypts the moment the key arrives.
 *                 HOLD — never advance past it, never count it toward give-up,
 *                 never drop it.
 *   'transient' — decoded fine but applying it failed (a throwing handler). The
 *                 drain retries under a GENEROUS bound.
 *   'permanent' — genuinely unrecoverable: plaintext over the vault, a malformed
 *                 row, or a decrypt that FAILS WITH THE KEY PRESENT (corrupt /
 *                 wrong-key ciphertext, not merely locked). Give up + advance.
 *
 * The critical distinction is key presence: decrypt-fails-BECAUSE-key-absent →
 * 'hold-key'; decrypt-fails-WITH-key-present → 'permanent'. Same-looking error,
 * opposite handling.
 *
 * @param raw  the decoded envelope object from parseIntentRow().envelope
 */
async function routeRow(raw, onEnvelope, getRootKey) {
  // Zero-knowledge enforcement: a non-encrypted row over the vault is a contract
  // violation — reject (permanent), never parse/route it.
  if (!raw || raw.encrypted !== true) {
    console.warn('[intents:vault] rejecting plaintext row over the vault (zero-knowledge violation):', raw?.event_id)
    return 'permanent'
  }

  // KEY-UNAVAILABLE → HOLD. This row is valid data that is merely locked; it
  // decrypts as soon as the key is derived (unlock) or migrated. Dropping it would
  // silently lose a user's cross-app action, so it waits — indefinitely, uncounted.
  const rootKey = await getRootKey()
  if (!rootKey) return 'hold-key'

  // The key IS present. Any decode failure now is genuinely PERMANENT — corrupt
  // ciphertext, a wrong/stale key, or a malformed envelope — not a lock. Advance
  // past so the queue can't wedge; key-absent was the only recoverable case and it
  // was handled above.
  const deriveFn = makeDeriveFn(rootKey)
  let envelope
  try {
    envelope = await parseEncryptedEnvelope(raw, deriveFn)
  } catch (err) {
    console.warn('[intents:vault] permanent decode failure with key present, advancing past:', err?.name || err)
    return 'permanent'
  }

  // Loopback: skip our own emitted rows (consumed — advance, do not apply).
  if (envelope.emitted_by === SOURCE_APPS.LIFEGLANCE) return 'ok'

  // TRANSIENT: decoded fine, but the handler (application logic) threw — e.g. a
  // transient DB error. Retryable under the generous bound in the drain.
  try {
    await onEnvelope(envelope)
  } catch (err) {
    console.warn('[intents:vault] handler error (transient), will retry:', err?.name || err)
    return 'transient'
  }
  return 'ok'
}

/**
 * Paginated drain from the vault intents endpoint. Lists from a cursor, decodes +
 * routes each row through `onEnvelope` (the app's EXISTING application logic), and
 * advances the cursor ONLY on consumed rows. A send NEVER touches this cursor.
 *
 * Three-way classification (per row), so a locked row is never a lost row:
 *   • ok         → advance + clear the seq's counter
 *   • hold-key   → KEY-UNAVAILABLE: stop the drain and HOLD at the cursor. Never
 *     advance, never count toward give-up, never drop. All later rows need the same
 *     key, so we surface how many are waiting and return; a re-drain fires when the
 *     key arrives (the poller listens for 'lifeglance:intents-key-ready').
 *   • transient (handler threw / network) → HOLD (stop the drain so the next poll
 *     retries from here); only at ≥ MAX_TRANSIENT_RETRIES (a GENEROUS bound) give
 *     up LOUDLY (clear + advance so it can't wedge the channel)
 *   • permanent (decrypt-with-key-present / plaintext-over-vault / malformed) →
 *     give up + advance + log LOUDLY
 *
 * Returns { heldForKey } — the count held pending the key this drain (0 if none).
 */
export async function drainVaultIntents(onEnvelope, deps = {}) {
  const conn = deps.connection ?? readVaultIntentsConnection()
  if (!conn) return // vault not enabled — nothing to drain (WebDAV path is separate)

  const doFetch    = resolveFetch(deps)
  const getRootKey = deps.getRootKey ?? loadVaultIntentsRootKey
  const limit      = deps.limit ?? PAGE_SIZE
  const store      = deps.cursorStore ?? makeLocalStorageCursorStore()

  let since   = parseSince(store.getCursor())
  let hasMore = true

  while (hasMore) {
    let res
    try {
      res = await vaultRequest(conn, doFetch, 'GET', '/intents/list', {
        query: { accountId: conn.accountId, since: formatSince(since), limit: String(limit) },
      })
    } catch {
      return // network error — transient, retry next poll; cursor untouched
    }
    if (!res.ok) return // 5xx/etc — transient; do not advance
    let body
    try { body = await res.json() } catch { return }

    const rows = Array.isArray(body?.rows) ? body.rows : []
    hasMore = body?.hasMore === true

    for (let i = 0; i < rows.length; i++) {
      const rawRow = rows[i]
      let parsed
      try {
        parsed = parseIntentRow(rawRow)
      } catch {
        // malformed server row → PERMANENT: advance past it (trust the row's seq)
        // so a re-list can't re-fail on it forever and wedge the queue.
        console.warn('[intents:vault] permanent: malformed server row, advancing past seq', rawRow?.seq)
        if (Number.isInteger(rawRow?.seq)) { since = rawRow.seq; store.setCursor(formatSince(since)) }
        continue
      }

      const seq = parsed.seq
      let outcome
      try {
        outcome = await routeRow(parsed.envelope, onEnvelope, getRootKey)
      } catch (err) {
        // routeRow classifies internally and shouldn't throw; if it does (e.g.
        // getRootKey rejects), treat it as transient — never drop.
        console.warn('[intents:vault] unexpected drain error (transient):', err?.name || err)
        outcome = 'transient'
      }

      // ── KEY-UNAVAILABLE → HOLD (never drop, never advance, never count) ────────
      if (outcome === 'hold-key') {
        // Every remaining row needs the same key, so stop here and hold at the
        // cursor. A held intent must be OBSERVABLE, not a silent stall, so report
        // the count. A re-drain fires when the key arrives (poller listens for
        // 'lifeglance:intents-key-ready', dispatched when the key is derived).
        const held = rows.length - i
        console.warn(`[intents:vault] ${held} intent(s) held pending vault-intents key (from seq ${seq}); will process when the key is available`)
        deps.onHeldPendingKey?.({ count: held, sinceSeq: seq })
        return { heldForKey: held }
      }

      // ── PERMANENT → give up: advance past + clear so the queue can't wedge ─────
      if (outcome === 'permanent') {
        store.clearRetry(seq)
        since = seq
        store.setCursor(formatSince(since))
        continue
      }

      // ── TRANSIENT (handler / network) → HOLD, bounded by a GENEROUS cap ────────
      if (outcome === 'transient') {
        const n = store.bumpRetry(seq)
        if (n >= MAX_TRANSIENT_RETRIES) {
          console.warn(`[intents:vault] giving up on seq ${seq} (${parsed.envelope?.event_id}) after ${n} transient retries; advancing past`)
          store.clearRetry(seq)
          since = seq
          store.setCursor(formatSince(since))
          continue
        }
        return { heldForKey: 0 } // hold at this row; the next poll retries from here
      }

      // ── OK → consumed: advance + clear the counter ────────────────────────────
      store.clearRetry(seq)
      since = seq
      store.setCursor(formatSince(since))
    }
  }
  return { heldForKey: 0 }
}
