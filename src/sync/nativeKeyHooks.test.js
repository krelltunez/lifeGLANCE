import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

const nativeStore = new Map()
const broken = { value: false }
vi.mock('../native/secureStore.js', () => ({
  isSecureStoreAvailable: true,
  secureGet: vi.fn(async (key) => {
    if (broken.value) throw new Error('native failure')
    return nativeStore.has(key) ? nativeStore.get(key) : null
  }),
  secureSet: vi.fn(async (key, value) => {
    if (broken.value) throw new Error('native failure')
    nativeStore.set(key, value)
  }),
  secureDelete: vi.fn(async (key) => {
    if (broken.value) throw new Error('native failure')
    nativeStore.delete(key)
  }),
}))

import { FILE_SYNC_KEY_HOOKS, DB_ROOT_KEY_HOOKS } from './nativeKeyHooks.js'

// Seed a legacy crypto DB the way @glance-apps/sync laid it out.
function seedLegacyDb(dbName, storeName, record) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(storeName, { keyPath: 'id' })
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).put(record)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
  })
}

function readLegacy(dbName, storeName, id) {
  return new Promise((resolve) => {
    const req = indexedDB.open(dbName)
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve(null); return }
      const get = db.transaction(storeName, 'readonly').objectStore(storeName).get(id)
      get.onsuccess = () => { db.close(); resolve(get.result ?? null) }
      get.onerror = () => { db.close(); resolve(null) }
    }
    req.onerror = () => resolve(null)
  })
}

describe('nativeKeyHooks', () => {
  beforeEach(() => {
    nativeStore.clear()
    broken.value = false
    // Fresh IndexedDB universe per test.
    globalThis.indexedDB = new IDBFactory()
  })

  it('returns null when neither store has a key', async () => {
    expect(await FILE_SYNC_KEY_HOOKS.nativeGetSyncKey()).toBeNull()
  })

  it('round-trips through the store hook', async () => {
    const blob = btoa(JSON.stringify({ rawKey: [1, 2, 3], salt: [4, 5, 6] }))
    FILE_SYNC_KEY_HOOKS.nativeStoreSyncKey(blob)
    await vi.waitFor(async () => {
      expect(await FILE_SYNC_KEY_HOOKS.nativeGetSyncKey()).toBe(blob)
    })
  })

  it('store(null) clears the entry (package clear semantics)', async () => {
    FILE_SYNC_KEY_HOOKS.nativeStoreSyncKey(btoa('{"rawKey":[1],"salt":[2]}'))
    FILE_SYNC_KEY_HOOKS.nativeStoreSyncKey(null)
    await vi.waitFor(async () => {
      expect(await FILE_SYNC_KEY_HOOKS.nativeGetSyncKey()).toBeNull()
    })
  })

  it('migrates the legacy file-sync key record (ArrayBuffer rawKey) and deletes it', async () => {
    const rawKey = new Uint8Array([9, 8, 7, 6]).buffer
    await seedLegacyDb('lifeglance-crypto', 'keys', { id: 'sync-key', rawKey, salt: [1, 2] })

    const blob = await FILE_SYNC_KEY_HOOKS.nativeGetSyncKey()
    expect(blob).not.toBeNull()
    expect(JSON.parse(atob(blob))).toEqual({ rawKey: [9, 8, 7, 6], salt: [1, 2] })
    // Migrated into the secure store, wiped from IndexedDB (risk note: the
    // legacy record is extractable raw bytes — it must not survive).
    expect(nativeStore.get('crypto.sync-key')).toBe(blob)
    expect(await readLegacy('lifeglance-crypto', 'keys', 'sync-key')).toBeNull()
  })

  it('migrates the legacy DB root key record and deletes it', async () => {
    await seedLegacyDb('lifeglance-crypto-db', 'db-root-keys', { id: 'db-root-key', rootBytes: [5, 5], salt: [6, 6] })

    const blob = await DB_ROOT_KEY_HOOKS.nativeGetSyncKey()
    expect(JSON.parse(atob(blob))).toEqual({ rootBytes: [5, 5], salt: [6, 6] })
    expect(nativeStore.get('crypto.db-root-key')).toBe(blob)
    expect(await readLegacy('lifeglance-crypto-db', 'db-root-keys', 'db-root-key')).toBeNull()
  })

  it('file and db tiers use distinct secure-store entries', async () => {
    FILE_SYNC_KEY_HOOKS.nativeStoreSyncKey(btoa(JSON.stringify({ rawKey: [1], salt: [1] })))
    DB_ROOT_KEY_HOOKS.nativeStoreSyncKey(btoa(JSON.stringify({ rootBytes: [2], salt: [2] })))
    await vi.waitFor(() => {
      expect(nativeStore.size).toBe(2)
    })
    const file = JSON.parse(atob(await FILE_SYNC_KEY_HOOKS.nativeGetSyncKey()))
    const dbRoot = JSON.parse(atob(await DB_ROOT_KEY_HOOKS.nativeGetSyncKey()))
    expect(file.rawKey).toEqual([1])
    expect(dbRoot.rootBytes).toEqual([2])
  })

  it('a failing native layer still returns the legacy key and keeps the record for retry', async () => {
    // Regression companion to lastGLANCE's 2.1.0 rc Keystore bug: a broken
    // SecureStore must not present as a lost encryption key (passphrase
    // re-prompt).
    await seedLegacyDb('lifeglance-crypto', 'keys', { id: 'sync-key', rawKey: [3, 1, 4], salt: [1, 5] })
    broken.value = true

    const blob = await FILE_SYNC_KEY_HOOKS.nativeGetSyncKey()
    expect(JSON.parse(atob(blob))).toEqual({ rawKey: [3, 1, 4], salt: [1, 5] })
    // Legacy record survives for the next boot's migration retry.
    expect(await readLegacy('lifeglance-crypto', 'keys', 'sync-key')).not.toBeNull()
    expect(nativeStore.size).toBe(0)
  })

  it('a malformed legacy record reads as absent (fail-safe)', async () => {
    await seedLegacyDb('lifeglance-crypto', 'keys', { id: 'sync-key', wrongField: true })
    expect(await FILE_SYNC_KEY_HOOKS.nativeGetSyncKey()).toBeNull()
    expect(nativeStore.size).toBe(0)
  })
})
