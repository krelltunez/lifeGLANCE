// =============================================================================
// blobTransport — client for the glance-vault blob endpoints (Phase 7, step 2)
// =============================================================================
//
// Drives the glance-vault blob HTTP API on top of the crypto core
// (./blobCrypto.js). It does NOT generate thumbnails and does NOT wire blobs to
// milestone entities — those are later steps. This file owns only the transport:
// encrypt → existence-check → resumable upload → finalize, and download →
// decrypt, plus existence and reference helpers.
//
// CONNECTION MODEL — it reuses the SAME vault connection lifeGLANCE's sync uses:
// `{ vaultUrl, vaultToken, accountId }`, the GLANCEvault server coordinates
// (mirrors @glance-apps/sync's createVaultClient — Bearer token, account-scoped).
// lifeGLANCE persists that under `lifeglance-cloud-sync-config` (the sync engine's
// KEY_CONFIG). We read it from there. The connection, the fetch implementation,
// and the root-key source are all INJECTABLE so this module is testable in
// isolation and so a native/Electron shell can supply its own network bridge —
// exactly as the sync vault client makes `fetchImpl` injectable.
//
// AUTH + SCOPING (mirrors @glance-apps/sync vaultClient.js):
//   • Every request carries `Authorization: Bearer <vaultToken>`.
//   • `accountId` scopes every endpoint: a query param on GET/HEAD/PUT-part,
//     a body field on the JSON POSTs (initiate / finalize / ref-add / ref-release).
//
// THE SERVER CONTRACT (all device-token auth, account-scoped):
//   HEAD /blobs/:hash                      → 200 exists / 404 absent
//   POST /blobs/uploads                    → initiate (idempotent on hash) { uploadId }
//   PUT  /blobs/uploads/:id/parts/:i       → store one part (raw octet-stream body)
//   GET  /blobs/uploads/:id                → resume point { received:[i,...], partSize, size }
//   POST /blobs/uploads/:id/finalize       → reassemble, VERIFY hash, store
//   GET  /blobs/:hash       (Range)        → download (full or partial) stored bytes
//   POST /blobs/:hash/ref-add | ref-release→ reference tracking
//
// THE HASH SEAM (the load-bearing invariant this step proves):
//   The stored blob bytes are [nonce(12) || ciphertext+tag] and the address is
//   `hash = SHA-256(those exact bytes)` (see blobCrypto.js). The client uploads
//   those exact bytes in order; on finalize the server reassembles the parts,
//   recomputes SHA-256 over the reassembled bytes, and MUST get the same hash the
//   client declared. Same bytes hashed the same way ⇒ finalize accepts. The
//   end-to-end test exercises precisely this seam.
//
// NEVER PLAINTEXT TO THE VAULT: upload always encrypts first; if the blob key is
// unavailable, BlobKeyUnavailableError propagates and NOTHING is sent — the
// caller treats it as a hold/retry, mirroring the intents key-absent path.
//
// FUTURE: like blobCrypto.js, this is structured for extraction into a shared
// `@glance-apps/*` package — it imports only the crypto core and reads the
// connection through an injectable seam, with no UI or milestone dependencies.
// (Native binary routing — Range + arrayBuffer over CapacitorHttp — is a
// follow-up for the native-shell cutover; the default global-fetch path covers
// browser/PWA and is what `fetchImpl` injection swaps out.)
// =============================================================================

import { encryptBlob, decryptBlob } from './blobCrypto.js'
import { nativeVaultFetchImpl } from '../sync/nativeVaultFetch.js'

/** Default resumable-upload part size: 1 MiB. */
export const DEFAULT_PART_SIZE = 1024 * 1024

const SYNC_CONFIG_KEY = 'lifeglance-cloud-sync-config'

/**
 * The vault connection is not configured / not ready yet (no URL, token, or
 * accountId). A TRANSIENT, hold/retry condition — mirrors how the sync engine
 * treats ACCOUNT_ID_REQUIRED as "not ready yet, retry next cycle", never a hard
 * error. The caller should retry once the vault connection is populated.
 */
export class VaultConnectionUnavailableError extends Error {
  code = 'VAULT_NOT_READY'
  transient = true
  constructor(message = 'vault connection not available (URL, token, or accountId missing)') {
    super(message)
    this.name = 'VaultConnectionUnavailableError'
  }
}

/** A blob endpoint returned a non-OK status. Carries the HTTP status. */
export class BlobTransportError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'BlobTransportError'
    this.status = status
  }
}

/**
 * Finalize rejected the upload because the server's hash of the reassembled
 * bytes did not equal the client's declared hash. This should never happen for
 * an intact upload — it means the bytes the server reassembled differ from the
 * bytes the client hashed (corruption / a contract bug), and is the failure the
 * end-to-end test asserts does NOT occur on the happy path.
 */
export class BlobHashMismatchError extends Error {
  constructor(hash) {
    super(`finalize rejected: server hash of reassembled bytes != declared hash ${hash}`)
    this.name = 'BlobHashMismatchError'
    this.hash = hash
  }
}

// ── Connection resolution ────────────────────────────────────────────────────

/**
 * Read the vault connection from lifeGLANCE's sync config (the same place
 * @glance-apps/sync's vault transport reads it). Returns null if absent or
 * incomplete — callers turn that into a VaultConnectionUnavailableError.
 */
export function readVaultConnection() {
  let cfg
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY)
    cfg = raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
  if (!cfg) return null
  const vaultUrl = cfg.vaultUrl
  const vaultToken = cfg.vaultToken
  const accountId = cfg.accountId
  if (
    typeof vaultUrl !== 'string' || vaultUrl.trim() === '' ||
    typeof vaultToken !== 'string' || vaultToken.trim() === '' ||
    typeof accountId !== 'string' || accountId.trim() === ''
  ) {
    return null
  }
  return { vaultUrl, vaultToken, accountId }
}

function resolveConnection(deps) {
  const conn = deps.connection ?? readVaultConnection()
  if (!conn) throw new VaultConnectionUnavailableError()
  return conn
}

function resolveFetch(deps) {
  // On native, route vault blob requests through CapacitorHttp (undefined on web,
  // so the browser/PWA keeps using global fetch — the vault serves CORS there).
  // This is the same native-safe adapter the sync vault client and verify probe
  // use, so the blob control plane reaches the vault on native ahead of the
  // Phase 8 media round-trip.
  const native = nativeVaultFetchImpl()
  const f = deps.fetchImpl ?? native ?? globalThis.fetch
  if (typeof f !== 'function') {
    throw new Error('blobTransport: no fetch implementation available')
  }
  return f
}

// ── Request helper (mirrors vaultClient.js request/authHeaders) ───────────────

async function vaultRequest(conn, doFetch, method, path, opts = {}) {
  let url = conn.vaultUrl.replace(/\/+$/, '') + path
  if (opts.query) {
    const qs = new URLSearchParams(opts.query).toString()
    if (qs) url += `?${qs}`
  }
  const init = {
    method,
    headers: { Authorization: `Bearer ${conn.vaultToken}`, ...opts.headers },
  }
  if (opts.jsonBody !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(opts.jsonBody)
  } else if (opts.binaryBody !== undefined) {
    init.headers['Content-Type'] = 'application/octet-stream'
    init.body = opts.binaryBody
  }
  // Hint for a binary response body (blob download). Ignored by the browser's
  // real fetch (which reads .arrayBuffer() natively); used by the native
  // CapacitorHttp adapter to request an arraybuffer/base64 read.
  if (opts.responseType) init.responseType = opts.responseType
  return doFetch(url, init)
}

// Read a short snippet of the response body to attach to an error message. The
// server explains a 4xx (missing/invalid field, wrong shape) in its body; without
// it, callers see a bare status and can't tell WHY the request was rejected. Best
// effort: never throw from here (a body may be unreadable or already consumed).
async function readErrorBody(res) {
  try {
    const text = typeof res.text === 'function' ? await res.text() : ''
    const trimmed = (text || '').trim()
    return trimmed ? ` — ${trimmed.slice(0, 300)}` : ''
  } catch {
    return ''
  }
}

async function jsonOrThrow(res, context) {
  if (!res.ok) {
    throw new BlobTransportError(`${context} failed: ${res.status}${await readErrorBody(res)}`, res.status)
  }
  return res.json()
}

// ── Existence check ──────────────────────────────────────────────────────────

/**
 * HEAD /blobs/:hash — does the server already hold this content?
 * @returns true if present (2xx), false if absent (404).
 * @throws  BlobTransportError on any other status.
 */
export async function blobExists(hash, deps = {}) {
  const conn = resolveConnection(deps)
  const doFetch = resolveFetch(deps)
  let res
  try {
    res = await vaultRequest(conn, doFetch, 'HEAD', `/blobs/${encodeURIComponent(hash)}`, {
      query: { accountId: conn.accountId },
    })
  } catch {
    // The existence check is a dedup OPTIMIZATION, not a correctness gate. If the
    // HEAD can't even be performed at the transport level — notably some native
    // HTTP stacks (CapacitorHttp over HttpURLConnection) reject/choke on HEAD —
    // don't abort the whole upload. Proceed as "not known present": initiate is
    // idempotent on the hash and finalize verifies, so a redundant upload is safe
    // (never data loss). Real HTTP errors still surface — a 401/500 comes back as
    // a status below, or resurfaces on the subsequent initiate call.
    return false
  }
  if (res.ok) return true
  if (res.status === 404) return false
  throw new BlobTransportError(`blob existence check failed: ${res.status}${await readErrorBody(res)}`, res.status)
}

// ── Upload ───────────────────────────────────────────────────────────────────

function splitIntoParts(bytes, partSize) {
  const parts = []
  for (let off = 0; off < bytes.length; off += partSize) {
    parts.push(bytes.subarray(off, Math.min(off + partSize, bytes.length)))
  }
  // A zero-length blob still uploads exactly one (empty) part so finalize has a
  // session to reassemble.
  if (parts.length === 0) parts.push(bytes.subarray(0, 0))
  return parts
}

/** POST /blobs/uploads — initiate (idempotent on hash) → uploadId. */
async function initiateUpload(conn, doFetch, hash, size, partSize) {
  const res = await vaultRequest(conn, doFetch, 'POST', '/blobs/uploads', {
    jsonBody: { accountId: conn.accountId, hash, size, partSize },
  })
  const body = await jsonOrThrow(res, 'initiate upload')
  if (!body || typeof body.uploadId !== 'string') {
    throw new BlobTransportError('initiate upload: missing uploadId in response', res.status)
  }
  return body.uploadId
}

/** GET /blobs/uploads/:id — which part indices the server already holds. */
async function getResumePoint(conn, doFetch, uploadId) {
  const res = await vaultRequest(conn, doFetch, 'GET', `/blobs/uploads/${encodeURIComponent(uploadId)}`, {
    query: { accountId: conn.accountId },
  })
  const body = await jsonOrThrow(res, 'resume point')
  const received = Array.isArray(body?.received) ? body.received : []
  return new Set(received)
}

/** PUT /blobs/uploads/:id/parts/:i — send one part (raw bytes). */
async function putPart(conn, doFetch, uploadId, index, part) {
  const res = await vaultRequest(
    conn,
    doFetch,
    'PUT',
    `/blobs/uploads/${encodeURIComponent(uploadId)}/parts/${index}`,
    { query: { accountId: conn.accountId }, binaryBody: part },
  )
  if (!res.ok) {
    throw new BlobTransportError(`upload part ${index} failed: ${res.status}${await readErrorBody(res)}`, res.status)
  }
}

/** POST /blobs/uploads/:id/finalize — reassemble + verify hash + store. */
async function finalizeUpload(conn, doFetch, uploadId, hash) {
  const res = await vaultRequest(
    conn,
    doFetch,
    'POST',
    `/blobs/uploads/${encodeURIComponent(uploadId)}/finalize`,
    { jsonBody: { accountId: conn.accountId, hash } },
  )
  if (res.ok) return
  // Read the body ONCE (it may only be readable once), then inspect it: the server
  // signals a hash mismatch distinctly so we can surface that clearly, and any
  // other 4xx reason is carried through in the generic error message.
  let bodyText = ''
  try {
    bodyText = typeof res.text === 'function' ? await res.text() : ''
  } catch {
    /* body unreadable — fall through with no detail */
  }
  if (res.status === 409 || res.status === 422 || res.status === 400) {
    let err = null
    try {
      err = bodyText ? JSON.parse(bodyText) : null
    } catch {
      /* not JSON — fall through to generic */
    }
    if (err && err.error === 'hash_mismatch') throw new BlobHashMismatchError(hash)
  }
  const detail = bodyText.trim() ? ` — ${bodyText.trim().slice(0, 300)}` : ''
  throw new BlobTransportError(`finalize failed: ${res.status}${detail}`, res.status)
}

/**
 * Encrypt, then upload a blob to the vault, returning its content address (hash).
 *
 * 1. encryptBlob(plaintext) → { bytes, hash }. If the blob key is unavailable,
 *    BlobKeyUnavailableError propagates and NOTHING is uploaded — never plaintext.
 * 2. Existence check (HEAD): if the server already holds this hash, skip the
 *    upload entirely (dedup) and return the hash — a re-upload is a no-op.
 * 3. Otherwise a resumable upload: initiate (idempotent on hash), read the resume
 *    point, send only the parts the server is still missing, then finalize. An
 *    interrupted upload resumes from the server's resume point rather than
 *    restarting.
 * 4. Return the hash on success.
 *
 * @throws {import('./blobCrypto.js').BlobKeyUnavailableError} if the key is absent.
 * @throws {VaultConnectionUnavailableError} if the vault connection is not ready.
 * @throws {BlobHashMismatchError} if finalize rejects the declared hash.
 * @throws {BlobTransportError} on other non-OK responses.
 */
export async function uploadBlob(plaintext, deps = {}) {
  const conn = resolveConnection(deps)
  const doFetch = resolveFetch(deps)
  const partSize = deps.partSize ?? DEFAULT_PART_SIZE

  // Encrypt FIRST. A missing key throws BlobKeyUnavailableError here, before any
  // network call — so nothing is sent and the caller can hold/retry.
  const { bytes, hash } = await encryptBlob(plaintext, deps.getRootKey)

  // Dedup: if the server already has these exact bytes, we're done.
  if (await blobExists(hash, deps)) return hash

  // Resumable upload. Initiate is idempotent on the hash, so a retry after an
  // interruption returns the same session with its already-received parts.
  const uploadId = await initiateUpload(conn, doFetch, hash, bytes.length, partSize)
  const received = await getResumePoint(conn, doFetch, uploadId)

  const parts = splitIntoParts(bytes, partSize)
  for (let i = 0; i < parts.length; i++) {
    if (received.has(i)) continue // resume: skip parts the server already holds
    await putPart(conn, doFetch, uploadId, i, parts[i])
  }

  await finalizeUpload(conn, doFetch, uploadId, hash)
  return hash
}

// ── Download ─────────────────────────────────────────────────────────────────

function rangeHeader(range) {
  return range.end === undefined
    ? `bytes=${range.start}-`
    : `bytes=${range.start}-${range.end}`
}

/**
 * GET /blobs/:hash — fetch the raw STORED bytes ([nonce || ciphertext]), optionally
 * a byte range for partial/streaming use. This returns ciphertext, NOT plaintext:
 * a partial range cannot be GCM-decrypted on its own (the tag covers the whole
 * message), so range fetches are for streaming/transfer, and full decryption goes
 * through {@link downloadBlob}.
 *
 * @throws {VaultConnectionUnavailableError} if the vault connection is not ready.
 * @throws {BlobTransportError} on a non-OK response.
 */
export async function downloadBlobBytes(hash, deps = {}) {
  const conn = resolveConnection(deps)
  const doFetch = resolveFetch(deps)
  const headers = {}
  if (deps.range) headers['Range'] = rangeHeader(deps.range)
  const res = await vaultRequest(conn, doFetch, 'GET', `/blobs/${encodeURIComponent(hash)}`, {
    query: { accountId: conn.accountId },
    headers,
    responseType: 'arraybuffer', // native adapter reads bytes; browser fetch ignores it
  })
  if (!res.ok) {
    throw new BlobTransportError(`download failed: ${res.status}${await readErrorBody(res)}`, res.status)
  }
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Download a full blob and decrypt it to plaintext. Decryption verifies the
 * GCM tag, so a tampered/corrupt blob fails clearly (the decrypt rejects).
 *
 * @throws {import('./blobCrypto.js').BlobKeyUnavailableError} if the key is absent.
 * @throws if the downloaded bytes fail GCM verification (tampered/corrupt).
 */
export async function downloadBlob(hash, deps = {}) {
  const bytes = await downloadBlobBytes(hash, deps)
  return decryptBlob(bytes, deps.getRootKey)
}

// ── Reference tracking ───────────────────────────────────────────────────────
// Thin wrappers over the server's ref-add / ref-release. WHEN these are called
// (on milestone create/delete) is the wiring step — not this module.

/** POST /blobs/:hash/ref-add — increment the reference count for a blob. */
export async function addBlobRef(hash, deps = {}) {
  const conn = resolveConnection(deps)
  const doFetch = resolveFetch(deps)
  const res = await vaultRequest(conn, doFetch, 'POST', `/blobs/${encodeURIComponent(hash)}/ref-add`, {
    jsonBody: { accountId: conn.accountId },
  })
  if (!res.ok) throw new BlobTransportError(`ref-add failed: ${res.status}${await readErrorBody(res)}`, res.status)
}

/** POST /blobs/:hash/ref-release — decrement the reference count for a blob. */
export async function releaseBlobRef(hash, deps = {}) {
  const conn = resolveConnection(deps)
  const doFetch = resolveFetch(deps)
  const res = await vaultRequest(conn, doFetch, 'POST', `/blobs/${encodeURIComponent(hash)}/ref-release`, {
    jsonBody: { accountId: conn.accountId },
  })
  if (!res.ok) throw new BlobTransportError(`ref-release failed: ${res.status}${await readErrorBody(res)}`, res.status)
}
