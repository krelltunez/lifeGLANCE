// The renderer's secure store on the desktop (docs/desktop-app.md,
// Secure storage): the same get/set/delete contract the phone shells keep in
// the Android Keystore and the iOS Keychain (src/native/secureStore.js), here
// over Electron's safeStorage (the macOS Keychain, Windows DPAPI, the Linux
// secret service). Ciphertext lives in userData/secure-store.json.
//
// The contract, as on the phones: material that cannot be read on THIS
// machine reads as absent (null), and the app asks for the credentials again.
// A corrupt file, a key the OS will no longer decrypt, or a copy of the file
// from another machine all land there; nothing throws into the renderer.
//
// The cipher and the file are injected, so this is tested without Electron.

import fs from 'node:fs'
import { writeFileAtomicSync } from './atomicWrite.js'

export const MAX_KEY_LENGTH = 200
export const MAX_VALUE_LENGTH = 1_000_000

/**
 * Whether safeStorage protects anything here. On Linux it can fall back to a
 * hard-coded password ("basic_text") when no keyring is running; that is not
 * protection, so the store reports unavailable and the app keeps its web
 * storage, rather than claim a safety it does not give.
 */
export function secureStorageUsable(platform, encryptionAvailable, linuxBackend) {
  if (!encryptionAvailable) return false
  if (platform === 'linux') return linuxBackend !== undefined && linuxBackend !== 'basic_text' && linuxBackend !== 'unknown'
  return true
}

const validKey = (key) => typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH

export function createSecureStore({ file, cipher }) {
  let items = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (parsed.version === 1 && parsed.items && typeof parsed.items === 'object') {
      for (const [k, v] of Object.entries(parsed.items)) {
        if (validKey(k) && typeof v === 'string') items[k] = v
      }
    }
  } catch {
    items = {} // absent or unreadable: nothing stored
  }

  const save = () => writeFileAtomicSync(file, JSON.stringify({ version: 1, items }))

  return {
    get(key) {
      if (!validKey(key) || !(key in items)) return { value: null }
      try {
        return { value: cipher.decrypt(Buffer.from(items[key], 'base64')) }
      } catch {
        return { value: null }
      }
    },
    set(key, value) {
      if (!validKey(key)) throw new Error('Invalid key')
      if (typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) throw new Error('Invalid value')
      items[key] = cipher.encrypt(value).toString('base64')
      save()
    },
    delete(key) {
      if (!validKey(key) || !(key in items)) return
      delete items[key]
      save()
    },
  }
}
