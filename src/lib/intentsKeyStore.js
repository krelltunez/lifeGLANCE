// IndexedDB-backed store for the lifeGLANCE intents root key.
// Mirrors dayGLANCE's intentsKeyStore — separate from cloud sync's crypto DB.

import { deriveIntentsRootKey, deriveEnvelopeKey } from '@glance-apps/intents'

const DB_NAME    = 'lifeglance-intents-crypto'
const STORE_NAME = 'keys'
const KEY_ID     = 'intents-root-key'

let _rootKey = null   // module-level cache; survives re-renders, not page reload

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME)
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
  })
}

async function loadFromIDB() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(KEY_ID)
    req.onsuccess = e => resolve(e.target.result ?? null)
    req.onerror   = e => reject(e.target.error)
  })
}

async function saveToIDB(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(key, KEY_ID)
    req.onsuccess = () => resolve()
    req.onerror   = e => reject(e.target.error)
  })
}

// Returns the cached root key, or loads it from IDB on first call.
export async function loadIntentsRootKey() {
  if (_rootKey) return _rootKey
  _rootKey = await loadFromIDB()
  return _rootKey
}

// Derives and persists the root key from the passphrase + shared salt bytes.
export async function setupIntentsEncryption(passphrase, sharedRootSalt) {
  const key = await deriveIntentsRootKey(passphrase, sharedRootSalt)
  await saveToIDB(key)
  _rootKey = key
  return key
}

// Returns a deriveKey function bound to the current root key, or null if no key.
export function makeDeriveFn(rootKey) {
  if (!rootKey) return null
  return (salt) => deriveEnvelopeKey(rootKey, salt)
}

export function clearIntentsRootKey() {
  _rootKey = null
}
