// =============================================================================
// blobCrypto — client-side blob encryption core (Phase 7, client step 1)
// =============================================================================
//
// A self-contained, crypto-only module: encrypt a blob, decrypt it, and compute
// its content address. It does NOT do transfer/upload/download, thumbnailing, or
// milestone wiring — those are later steps. Its only dependency on the rest of
// the app is the *root key source* (the vault intents root key, reached exactly
// the way the intents path reaches it), and even that is injectable so this file
// can be lifted into a shared `@glance-apps/*` package later if dayGLANCE /
// lastGLANCE ever need media. (FUTURE: extract to a shared package — keep this
// module free of UI, transport, and emit-site imports so that stays cheap.)
//
// -----------------------------------------------------------------------------
// THE CONSTRUCTION (deterministic, content-addressed, authenticated)
// -----------------------------------------------------------------------------
// A blob is addressed by the hash of its CIPHERTEXT, and encryption is
// DETERMINISTIC: identical plaintext under the same key produces byte-identical
// ciphertext (hence the same address, hence dedup + idempotent upload).
//
//   1. KEY     blobKey = HKDF(rootKey, info="glance-blob-v1")           (§deriveBlobKey)
//   2. NONCE   nonce   = HMAC-SHA256(blobKey, plaintext)[:12]           (content-derived)
//   3. ENCRYPT ct      = AES-GCM(blobKey, nonce, plaintext)             (ct includes the tag)
//   4. STORE   bytes   = nonce(12) || ct                                (the wire/at-rest form)
//   5. ADDRESS hash    = SHA-256(bytes) hex-encoded                     (the content address)
//   6. DECRYPT split nonce off `bytes`, AES-GCM-decrypt the rest        (tag verifies integrity)
//
// STORED BYTE LAYOUT (exact):
//   ┌────────────── stored blob bytes ──────────────┐
//   │ nonce: 12 bytes │ ciphertext+tag: N+16 bytes  │
//   └─────────────────┴─────────────────────────────┘
//   - The nonce travels with the blob because decrypt needs it. It is derived
//     from the plaintext, so it is NOT secret — but it is unpredictable without
//     the key (it is a keyed hash), and the decryptor still needs it verbatim.
//   - AES-GCM ciphertext already carries its 16-byte auth tag appended by
//     WebCrypto; we do not store it separately.
//   - `hash` is SHA-256 over these EXACT stored bytes (nonce || ciphertext),
//     so it equals what the server recomputes when it verifies on finalize.
//
// -----------------------------------------------------------------------------
// SAFETY ARGUMENT — READ THIS BEFORE "SIMPLIFYING" ANYTHING HERE
// -----------------------------------------------------------------------------
// This is the load-bearing part. A deterministic, content-derived nonce looks
// like the classic "GCM nonce reuse" footgun. It is NOT, *because of how the
// nonce is derived*. Do not change the derivation without re-reading this.
//
//  • GCM nonce reuse is catastrophic ONLY across DIFFERENT plaintexts under the
//    same key (it leaks the XOR of the keystreams and forges the auth key).
//    Here the nonce is a function of (key, plaintext): nonce = HMAC(blobKey, pt).
//    Two DIFFERENT plaintexts get DIFFERENT nonces (HMAC-SHA256 is
//    collision-resistant), and a nonce repeats ONLY when the plaintext is
//    byte-identical — in which case the ENTIRE message is identical and there is
//    nothing to leak (encrypting the same bytes twice and getting the same
//    ciphertext is exactly the dedup property we want). Therefore deterministic
//    content-derived-nonce GCM is SAFE for this use. This is precisely why we do
//    NOT need AES-GCM-SIV (which WebCrypto lacks anyway).
//
//  • The nonce is derived WITH THE KEY (HMAC keyed by blobKey), so a keyless
//    party (e.g. the storage server) cannot compute the nonce, cannot confirm a
//    guessed plaintext, and cannot link/learn anything from the stored blob.
//    Addressing by the SHA-256 of the ciphertext leaks nothing to a keyless
//    server — it is the hash of pseudorandom bytes.
//
//  • We derive the NONCE from content, never the KEY. (Deriving the key from
//    content would be "convergent encryption" — weak, brute-forceable for
//    low-entropy plaintext. The key stays secret, derived from the vault root.)
//
// -----------------------------------------------------------------------------
// KEY DERIVATION — on the record, domain-separated (quote for §deriveBlobKey)
// -----------------------------------------------------------------------------
//   Root key source: loadVaultIntentsRootKey() — the same per-account vault root key
//     the sync/intents path uses (PBKDF2(syncPassphrase, /salt/:accountId) →
//     HKDF base CryptoKey, non-extractable, usages ["deriveKey"]). We reach it
//     through that existing cached/IDB-backed store; we never re-derive it here.
//   Blob key:  HKDF-SHA256(ikm = rootKey, salt = "" , info = "glance-blob-v1")
//     → 32 bytes, imported as both the AES-256-GCM key and the HMAC-SHA256 key.
//
//   Domain separation (same root, separate domains — no two can collide):
//     sync     : HKDF info "glance-sync:entity:<id>"
//     intents  : HKDF info "glance-intents-envelope-v1"
//     blobs    : HKDF info "glance-blob-v1"   ← this module
//
// =============================================================================

import { loadVaultIntentsRootKey } from '../lib/intentsKeyStore.js'

/** AES-GCM nonce length, in bytes. The stored blob is [nonce || ciphertext]. */
export const NONCE_LENGTH = 12

/** HKDF `info` string that domain-separates the blob key from sync and intents. */
export const HKDF_INFO_BLOB = 'glance-blob-v1'

/**
 * Raised when the vault root key is not available, so a blob cannot be
 * encrypted or decrypted. This is a CLEAR, TYPED signal — never a silent
 * no-op and never a plaintext fallback. Callers (in a later step) treat it the
 * way the intents path treats a missing key: a transient hold/retry condition
 * that resolves once vault key setup/restore completes.
 */
export class BlobKeyUnavailableError extends Error {
  constructor(message = 'blob key not available (vault root key not set up on this device)') {
    super(message)
    this.name = 'BlobKeyUnavailableError'
  }
}

const textEncoder = new TextEncoder()

function toBytes(data) {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

/**
 * Derive the blob key from the vault root key via HKDF with info
 * "glance-blob-v1" (see the KEY DERIVATION block above). The root key is a
 * non-extractable HKDF base key whose only usage is "deriveKey", so we derive an
 * extractable 256-bit key, export its raw bytes, and re-import those same bytes
 * as BOTH the AES-256-GCM key and the HMAC-SHA256 key — i.e. one blob key used
 * for both encryption and the keyed nonce, exactly as the construction requires.
 *
 * @param getRootKey  Source of the root key (default: the vault intents store).
 *                    Injectable so this module stays decoupled and testable.
 * @returns the BlobKey ({ aesKey, hmacKey }), or `null` if the root key is not available.
 */
export async function deriveBlobKey(getRootKey = loadVaultIntentsRootKey) {
  const rootKey = await getRootKey()
  if (!rootKey) return null

  // HKDF-SHA256 over the root key, domain-separated by info "glance-blob-v1".
  // Empty salt is intentional: the per-domain info string is the separator, and
  // the root key is already high-entropy keying material (RFC 5869 §3.1).
  const derived = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: textEncoder.encode(HKDF_INFO_BLOB),
    },
    rootKey,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true, // extractable: we re-import the same bytes as AES-GCM + HMAC
    ['sign'],
  )

  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', derived))
  const [aesKey, hmacKey] = await Promise.all([
    crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
    crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  ])
  return { aesKey, hmacKey }
}

/** SHA-256 of `bytes`, lowercase hex. */
async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let hex = ''
  for (const b of digest) hex += b.toString(16).padStart(2, '0')
  return hex
}

/**
 * Encrypt a blob deterministically and compute its content address.
 *
 * @param plaintext   The blob bytes (Uint8Array or ArrayBuffer).
 * @param getRootKey  Root key source (default: the vault intents store).
 * @returns `{ bytes, hash }` where `bytes` is the stored form [nonce || ciphertext]
 *          and `hash` is SHA-256(bytes) hex — the server-visible content address.
 * @throws  {BlobKeyUnavailableError} if the root key is unavailable. NEVER falls
 *          back to plaintext.
 */
export async function encryptBlob(plaintext, getRootKey = loadVaultIntentsRootKey) {
  const blobKey = await deriveBlobKey(getRootKey)
  if (!blobKey) throw new BlobKeyUnavailableError()

  const pt = toBytes(plaintext)

  // Content-derived nonce: HMAC-SHA256(blobKey, plaintext) truncated to 12 bytes.
  // Deterministic in (key, plaintext); unpredictable without the key.
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', blobKey.hmacKey, pt))
  const nonce = mac.slice(0, NONCE_LENGTH)

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, blobKey.aesKey, pt),
  )

  // Stored form: [nonce || ciphertext+tag].
  const bytes = new Uint8Array(NONCE_LENGTH + ciphertext.length)
  bytes.set(nonce, 0)
  bytes.set(ciphertext, NONCE_LENGTH)

  const hash = await sha256Hex(bytes)
  return { bytes, hash }
}

/**
 * Decrypt a stored blob.
 *
 * @param stored      The stored bytes [nonce || ciphertext], as produced by
 *                    {@link encryptBlob}.
 * @param getRootKey  Root key source (default: the vault intents store).
 * @returns the recovered plaintext bytes.
 * @throws  {BlobKeyUnavailableError} if the root key is unavailable.
 * @throws  if the blob has been tampered with (AES-GCM tag verification fails)
 *          or is malformed.
 */
export async function decryptBlob(stored, getRootKey = loadVaultIntentsRootKey) {
  const blobKey = await deriveBlobKey(getRootKey)
  if (!blobKey) throw new BlobKeyUnavailableError()

  if (stored.length < NONCE_LENGTH) {
    throw new Error('malformed blob: shorter than the nonce length')
  }
  const nonce = stored.slice(0, NONCE_LENGTH)
  const ciphertext = stored.slice(NONCE_LENGTH)

  // GCM tag verification happens inside decrypt: a tampered blob throws here.
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    blobKey.aesKey,
    ciphertext,
  )
  return new Uint8Array(plaintext)
}
