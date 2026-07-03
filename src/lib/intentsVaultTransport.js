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
// key the blob store uses — loadIntentsRootKey(), derived
// deriveIntentsRootKey(syncPassphrase, /salt/:accountId) and now reliably
// bootstrapped on every setup path (dbSync.js). Two GLANCE apps that feed the
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
  NoKeyError,
  SOURCE_APPS,
} from '@glance-apps/intents'
import { loadIntentsRootKey, makeDeriveFn } from './intentsKeyStore.js'
import { nativeVaultFetchImpl } from '../sync/nativeVaultFetch.js'

const SYNC_CONFIG_KEY = 'lifeglance-cloud-sync-config'
const VAULT_CURSOR_KEY  = 'lifeglance-intents-vault-cursor'
const VAULT_RETRIES_KEY = 'lifeglance-intents-vault-retries'

/** Server page size for /intents/list. A backlog larger than this spans pages. */
export const PAGE_SIZE = 500
/** Default intents TTL: 30 days. A default, not part of the wire contract. */
export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Receive-side bound: a permanently-throwing/keyless row can't wedge the channel. */
export const MAX_INTENT_RETRIES = 5

// ── Connection + fetch resolution (mirrors blobTransport) ─────────────────────

/**
 * Read the vault connection from lifeGLANCE's sync config, ONLY when vault sync
 * is explicitly enabled and all three coordinates are present. Gating on
 * vaultEnabled is what makes vault intents opt-in "like sync" — WebDAV intents
 * are untouched and run alongside. Returns null otherwise.
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

/** Whether the vault intents transport is enabled (a target for emitted intents). */
export function isVaultIntentsEnabled() {
  return !!readVaultIntentsConnection()
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

  const getRootKey = deps.getRootKey ?? loadIntentsRootKey
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
 * The vault intents key is absent. TRANSIENT — the key will arrive once
 * setup/restore completes, so hold + bounded-retry, never advance past.
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
 * Route one decoded server row's envelope. Returns 'ok' (consumed) or 'permanent'
 * (advance + log); THROWS for a transient (KeyUnavailableError, or a handler
 * error propagated from onEnvelope) so it flows into the drain's uniform
 * hold + bounded-retry branch.
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

  const rootKey = await getRootKey()
  if (!rootKey) throw new KeyUnavailableError() // key absent → transient (hold + retry)

  const deriveFn = makeDeriveFn(rootKey)
  let envelope
  try {
    envelope = await parseEncryptedEnvelope(raw, deriveFn)
  } catch (err) {
    // key present but the row won't decrypt (wrong key / bad ciphertext /
    // malformed) → PERMANENT (advance past). Only a genuinely-absent key is
    // transient — and we guarded that above; re-throw a codec NoKeyError as such.
    if (err instanceof NoKeyError) throw new KeyUnavailableError()
    console.warn('[intents:vault] permanent decode failure, advancing past:', err?.name || err)
    return 'permanent'
  }

  // Loopback: skip our own emitted rows (consumed — advance, do not apply).
  if (envelope.emitted_by === SOURCE_APPS.LIFEGLANCE) return 'ok'

  await onEnvelope(envelope) // handler throw → transient (caught by the drain)
  return 'ok'
}

/**
 * Paginated drain from the vault intents endpoint. Lists from a cursor, decodes +
 * routes each row through `onEnvelope` (the app's EXISTING application logic), and
 * advances the cursor ONLY on consumed rows. A send NEVER touches this cursor.
 *
 * Uniform bounded-retry model (per row):
 *   • success           → advance + clear the seq's counter
 *   • transient (handler threw OR vault key absent) → HOLD (stop the drain so the
 *     next poll retries from here); at ≥ MAX_INTENT_RETRIES give up LOUDLY
 *     (clear + advance so it can't wedge the channel)
 *   • permanent (decrypt-with-key / plaintext-over-vault / malformed) → advance + log
 */
export async function drainVaultIntents(onEnvelope, deps = {}) {
  const conn = deps.connection ?? readVaultIntentsConnection()
  if (!conn) return // vault not enabled — nothing to drain (WebDAV path is separate)

  const doFetch    = resolveFetch(deps)
  const getRootKey = deps.getRootKey ?? loadIntentsRootKey
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

    for (const rawRow of rows) {
      let parsed
      try {
        parsed = parseIntentRow(rawRow)
      } catch {
        // malformed server row → advance past it (permanent). Trust the row's seq
        // if present so we don't re-list it forever.
        if (Number.isInteger(rawRow?.seq)) { since = rawRow.seq; store.setCursor(formatSince(since)) }
        continue
      }

      const seq = parsed.seq
      let outcome
      try {
        outcome = await routeRow(parsed.envelope, onEnvelope, getRootKey)
      } catch (err) {
        // transient → bounded retry. HOLD unless we've hit the give-up bound.
        const n = store.bumpRetry(seq)
        if (n >= MAX_INTENT_RETRIES) {
          console.warn(`[intents:vault] giving up on seq ${seq} (${parsed.envelope?.event_id}) after ${n} retries:`, err?.name || err)
          store.clearRetry(seq)
          since = seq
          store.setCursor(formatSince(since))
          continue
        }
        return // stop the whole drain; the next poll retries from here
      }

      // success or permanent → advance + clear the counter.
      void outcome
      store.clearRetry(seq)
      since = seq
      store.setCursor(formatSince(since))
    }
  }
}
