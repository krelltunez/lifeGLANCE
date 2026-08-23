import { isSecureStoreAvailable, secureDelete, secureGet, secureSet } from '../native/secureStore.js'

// SecureStore-backed implementations of the `nativeGetSyncKey` /
// `nativeStoreSyncKey` hooks that `@glance-apps/sync` ships for exactly this
// purpose and that the app has so far passed as null. With the hooks present
// the package stops using its `lifeglance-crypto*` IndexedDB databases — the
// two records it kept there are extractable raw key bytes (`rawKey` for the
// file-sync key, `rootBytes` for the DB root key), the most sensitive
// artifacts in WebView storage.
//
// The package treats the hooks as either/or with IndexedDB (no fallback), so
// each getter carries its own one-time legacy migration: read the old record,
// re-encode it as the exact base64 blob the package's native path expects,
// store it in the SecureStore, then delete the IndexedDB copy (leaving it
// would defeat the point — the bytes are extractable where they sit).
//
// Two separately-bound hook pairs are required. The file tier and the DB tier
// use the SAME hook names in the package (`initSessionKey` vs `initDbRootKey`
// both call `nativeGetSyncKey`), so a single shared pair would make both
// tiers read and clobber one SecureStore entry — dayGLANCE's shared-slot
// passphrase re-prompt bug. FILE_SYNC_KEY_HOOKS binds to 'crypto.sync-key',
// DB_ROOT_KEY_HOOKS to 'crypto.db-root-key' (same slot names as lastGLANCE).
//
// Where no SecureStore plugin exists (web/PWA) both exports are empty objects:
// spread into a config they contribute nothing, the package sees no hooks, and
// IndexedDB behavior is unchanged.
//
// Ported from lastGLANCE (src/sync/nativeKeyHooks.ts); keep the two in sync
// when fixing bugs in either.

// Read one record from a legacy crypto DB without creating stores. Opening
// versionless never triggers an upgrade, so a missing store just reads null.
function readLegacyRecord(dbName, storeName, id) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(dbName)
      req.onerror = () => resolve(null)
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(storeName)) {
          db.close()
          resolve(null)
          return
        }
        const get = db.transaction(storeName, 'readonly').objectStore(storeName).get(id)
        get.onerror = () => { db.close(); resolve(null) }
        get.onsuccess = () => { db.close(); resolve(get.result ?? null) }
      }
    } catch {
      resolve(null)
    }
  })
}

function deleteLegacyRecord(dbName, storeName, id) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(dbName)
      req.onerror = () => resolve()
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(storeName)) {
          db.close()
          resolve()
          return
        }
        const tx = db.transaction(storeName, 'readwrite')
        tx.objectStore(storeName).delete(id)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); resolve() }
      }
    } catch {
      resolve()
    }
  })
}

// number[] | ArrayBuffer | TypedArray → plain number[] for the JSON blob.
function toByteArray(v) {
  if (Array.isArray(v)) return v
  if (v instanceof ArrayBuffer) return Array.from(new Uint8Array(v))
  if (ArrayBuffer.isView(v)) return Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
  return []
}

function makeHooks(storeKey, legacy, recordToBlob) {
  if (!isSecureStoreAvailable) return {}
  return {
    nativeGetSyncKey: async () => {
      try {
        const existing = await secureGet(storeKey)
        if (existing !== null) return existing
      } catch {
        // SecureStore read failed — fall through to the legacy record so a
        // native fault degrades to pre-migration behavior, not a re-prompt.
      }
      const record = await readLegacyRecord(legacy.dbName, legacy.storeName, legacy.id)
      if (!record) return null
      const blob = recordToBlob(record)
      if (!blob) return null
      const b64 = btoa(JSON.stringify(blob))
      try {
        await secureSet(storeKey, b64)
        await deleteLegacyRecord(legacy.dbName, legacy.storeName, legacy.id)
      } catch {
        // Secure write failed: keep the legacy record and still return the
        // key so this session works; the migration retries next boot. Never
        // let a broken native layer present as a lost encryption key.
      }
      return b64
    },
    nativeStoreSyncKey: (b64) => {
      // The package calls this fire-and-forget (null means "clear").
      void (b64 === null ? secureDelete(storeKey) : secureSet(storeKey, b64)).catch(() => {
        // Failed persist: the in-memory session key still works; next boot
        // falls back to the passphrase prompt (fail-safe).
      })
    },
  }
}

// File-tier sync key: record { rawKey: ArrayBuffer, salt: number[] } in
// lifeglance-crypto/keys, blob shape { rawKey: number[], salt: number[] }.
export const FILE_SYNC_KEY_HOOKS = makeHooks(
  'crypto.sync-key',
  { dbName: 'lifeglance-crypto', storeName: 'keys', id: 'sync-key' },
  (record) => {
    const rawKey = toByteArray(record.rawKey)
    const salt = toByteArray(record.salt)
    return rawKey.length && salt.length ? { rawKey, salt } : null
  },
)

// DB-tier root key: record { rootBytes: number[], salt: number[] } in
// lifeglance-crypto-db/db-root-keys (the package derives the `-db` DB name
// from cryptoDBName), blob shape { rootBytes, salt }.
export const DB_ROOT_KEY_HOOKS = makeHooks(
  'crypto.db-root-key',
  { dbName: 'lifeglance-crypto-db', storeName: 'db-root-keys', id: 'db-root-key' },
  (record) => {
    const rootBytes = toByteArray(record.rootBytes)
    const salt = toByteArray(record.salt)
    return rootBytes.length && salt.length ? { rootBytes, salt } : null
  },
)
