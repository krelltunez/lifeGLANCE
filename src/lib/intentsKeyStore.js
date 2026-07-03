// IndexedDB-backed store for lifeGLANCE's intents/blob root keys.
//
// TWO DISTINCT KEY SLOTS live in one IDB store, and they must NEVER be confused —
// they hold different key material derived from different salts:
//
//   • 'intents-root-key'  — the WebDAV FILE-TIER intents key, derived from the
//     WebDAV shared salt (intents-encryption-salt.json). Written by
//     enableIntentsEncryption(); read by the WebDAV intents deliverer/poller.
//
//   • 'vault-root-key'    — the GLANCEvault intents + BLOB key, derived from the
//     server-owned vault salt (/salt/:accountId). Written by the vault setup /
//     first-sync bootstrap; read by the vault intents transport and blobCrypto.
//
// They were ONE slot originally, which collided: a device with WebDAV-intents
// encryption on AND vault sync on wrote both a WebDAV-salt key and a vault-salt
// key into the same record (last-writer-wins), breaking blob and/or vault-intents
// decryption. Separating the slots makes that collision structurally impossible.
// Mirrors dayGLANCE's model (vault-root-key vs root-key); see the reference doc §4.2.

import { deriveIntentsRootKey, deriveEnvelopeKey } from '@glance-apps/intents'

const DB_NAME       = 'lifeglance-intents-crypto'
const STORE_NAME    = 'keys'
const KEY_ID        = 'intents-root-key'   // WebDAV file-tier intents key (WebDAV salt)
const VAULT_KEY_ID  = 'vault-root-key'     // vault intents + blob key (vault salt)
const INTENTS_CONFIG_KEY = 'lifeglance-intents-config'

let _rootKey      = null   // WebDAV-slot cache; survives re-renders, not page reload
let _vaultRootKey = null   // vault-slot cache; distinct from the WebDAV slot

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME)
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
  })
}

// Load one record (by its slot id) from the store.
async function loadFromIDB(recordKey) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(recordKey)
    req.onsuccess = e => resolve(e.target.result ?? null)
    req.onerror   = e => reject(e.target.error)
  })
}

// Persist one record (by its slot id) into the store.
async function saveToIDB(key, recordKey) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(key, recordKey)
    req.onsuccess = () => resolve()
    req.onerror   = e => reject(e.target.error)
  })
}

// ── WebDAV file-tier intents key ('intents-root-key') ─────────────────────────

// Returns the cached WebDAV intents root key, or loads it from IDB on first call.
export async function loadIntentsRootKey() {
  if (_rootKey) return _rootKey
  _rootKey = await loadFromIDB(KEY_ID)
  return _rootKey
}

// Derives and persists the WebDAV intents root key from the passphrase + the
// WebDAV shared salt bytes. (WebDAV path — unchanged; do not point vault callers here.)
export async function setupIntentsEncryption(passphrase, sharedRootSalt) {
  const key = await deriveIntentsRootKey(passphrase, sharedRootSalt)
  await saveToIDB(key, KEY_ID)
  _rootKey = key
  return key
}

// ── GLANCEvault intents + blob key ('vault-root-key') ─────────────────────────

// Did this device ever turn on WebDAV-intents encryption? Read directly from
// localStorage to avoid importing intentsTransport (which imports this module).
function webdavIntentsEncryptionEnabled() {
  try {
    const raw = localStorage.getItem(INTENTS_CONFIG_KEY)
    return !!(raw && JSON.parse(raw)?.encryptionEnabled)
  } catch {
    return false
  }
}

// One-time migration for devices upgraded from the shared-slot era. Before the
// split, a vault-only device (WebDAV-intents encryption never enabled) stored its
// VAULT key in 'intents-root-key'. Adopt that key into the new vault slot so blob
// and vault-intents access is NOT lost on upgrade — no passphrase needed, we just
// re-home the existing CryptoKey. Guarded: only when WebDAV-intents encryption was
// never enabled (else 'intents-root-key' may hold the WebDAV key, which must NOT
// become the vault key — that device re-derives the vault key on next sync).
async function migrateVaultKeyFromSharedSlot() {
  if (webdavIntentsEncryptionEnabled()) return null // shared slot may be the WebDAV key — don't adopt
  const legacy = await loadFromIDB(KEY_ID)
  if (!legacy) return null
  await saveToIDB(legacy, VAULT_KEY_ID) // re-home the vault key into its own slot
  return legacy
}

// Returns the cached vault intents/blob root key, loading it from the vault slot
// on first call. If the vault slot is empty, attempt the one-time migration from
// the legacy shared slot (see above) so upgraded vault-only devices keep access.
export async function loadVaultIntentsRootKey() {
  if (_vaultRootKey) return _vaultRootKey
  _vaultRootKey = await loadFromIDB(VAULT_KEY_ID)
  if (!_vaultRootKey) _vaultRootKey = await migrateVaultKeyFromSharedSlot()
  return _vaultRootKey
}

// Derives and persists the VAULT intents/blob root key from the passphrase + the
// server-owned vault salt. Writes ONLY the vault slot — never touches the WebDAV slot.
export async function setupVaultIntentsRootKey(passphrase, vaultSalt) {
  const key = await deriveIntentsRootKey(passphrase, vaultSalt)
  await saveToIDB(key, VAULT_KEY_ID)
  _vaultRootKey = key
  return key
}

// ── Shared helper ─────────────────────────────────────────────────────────────

// Returns a deriveKey function bound to the given root key, or null if no key.
export function makeDeriveFn(rootKey) {
  if (!rootKey) return null
  return (salt) => deriveEnvelopeKey(rootKey, salt)
}
