import { isSecureStoreAvailable, secureDelete, secureGet, secureSet } from '../native/secureStore.js'

// Keeps credential-bearing config out of localStorage on the native shells
// without touching any of the call sites that read it synchronously —
// including `@glance-apps/sync`, whose engine hard-codes
// `localStorage.getItem(...)` for its config key with no storage injection
// point. The only way its reads can hit a secure backend is to interpose on
// Storage itself, so that is exactly (and only) what this does:
//
// - `installSecureConfigShim()` patches Storage.prototype get/set/removeItem.
//   For an allow-list of secret keys on `window.localStorage`, reads are served
//   from an in-memory session cache and writes go to the cache plus a
//   write-through to the native SecureStore. Every other key, and everything on
//   sessionStorage, passes through untouched.
// - `hydrateSecureConfig()` runs once at boot, before React renders (and
//   therefore before the sync engine's first read): it migrates any legacy
//   plaintext value out of real localStorage into the SecureStore (one-time,
//   idempotent), then seeds the cache from the SecureStore.
//
// Known limits, deliberate: property-style access (`localStorage['k']`),
// enumeration (`length`/`key(i)`) and `clear()` are not intercepted — no
// consumer of these keys uses them (engine and app code use the method API
// throughout). Where no SecureStore plugin exists (web/PWA) neither function
// does anything, so behavior there is byte-for-byte the status quo.
//
// Ported from lastGLANCE (src/sync/secureConfigShim.ts); keep the two in sync
// when fixing bugs in either. One deliberate deviation: the plaintext
// migration here verifies by read-back before deleting the original (see
// hydrateSecureConfig), where lastGLANCE trusts the resolved write.

// Every localStorage key whose value contains a credential. The engine-owned
// names are `${storageKeyPrefix}-cloud-sync-config` / `-db-sync-config` with
// prefix 'lifeglance' (see engine.js / dbSync.js); they exist nowhere as
// importable constants, so they are spelled out here. Unlike lastGLANCE there
// is no separate vault-config key: the GLANCEvault token lives inside
// lifeglance-cloud-sync-config (vaultSetup.js merges both tiers there).
const SECRET_KEYS = new Set([
  'lifeglance-cloud-sync-config', // WebDAV password + appPassword + vaultToken (both tiers)
  'lifeglance-db-sync-config', // engine-owned twin, normally empty — covered so it can never leak
  'lifeglance-intents-config', // WebDAV password, second copy (intents transport webdavPass)
])

const cache = new Map()
let installed = false

// In-flight write-throughs, so a caller that is about to tear the page down
// can wait for the native side to actually have the credentials. lifeGLANCE
// currently re-inits engines in place rather than reloading, but the flush
// stays: its absence is the kind of thing discovered by a lost write.
const pending = new Set()

function track(p) {
  const guarded = p.catch(() => {
    // Native write failed: the cache still serves this session, and the worst
    // case on next boot is the fail-safe — the user re-enters credentials.
  })
  pending.add(guarded)
  void guarded.finally(() => pending.delete(guarded))
}

export function flushSecureWrites() {
  return Promise.all([...pending]).then(() => undefined)
}

// Original Storage.prototype methods, captured at install time. Hydration uses
// these to reach the real localStorage beneath the shim.
let origGetItem
let origSetItem
let origRemoveItem

export function installSecureConfigShim() {
  if (!isSecureStoreAvailable || installed) return
  installed = true

  const proto = Storage.prototype
  origGetItem = proto.getItem
  origSetItem = proto.setItem
  origRemoveItem = proto.removeItem

  proto.getItem = function (key) {
    if (this === window.localStorage && SECRET_KEYS.has(key)) {
      return cache.has(key) ? cache.get(key) : null
    }
    return origGetItem.call(this, key)
  }

  proto.setItem = function (key, value) {
    if (this === window.localStorage && SECRET_KEYS.has(key)) {
      const str = String(value)
      cache.set(key, str)
      track(secureSet(key, str))
      return
    }
    origSetItem.call(this, key, value)
  }

  proto.removeItem = function (key) {
    if (this === window.localStorage && SECRET_KEYS.has(key)) {
      cache.delete(key)
      track(secureDelete(key))
      return
    }
    origRemoveItem.call(this, key)
  }
}

// Boot-time hydration. Must complete before the first render (main.jsx awaits
// it): the sync engines and intents transport read these keys synchronously
// during mount, and a miss would present as "sync not configured".
export async function hydrateSecureConfig() {
  if (!installed) return
  for (const key of SECRET_KEYS) {
    try {
      // Migrate legacy plaintext first. If a plaintext copy exists it is the
      // newest write (pre-shim builds wrote here), so it wins over any secure
      // copy; removal makes the migration one-time. The cache is seeded BEFORE
      // the secure write and the plaintext is removed only AFTER it is
      // verified: a native failure must present as "still works like before,
      // migrates next boot", never as wiped settings (lastGLANCE's 2.1.0 rc
      // bug — a Keystore rejection made every write fail, and the shim
      // shadowed the intact plaintext with an empty cache).
      const legacy = origGetItem.call(window.localStorage, key)
      if (legacy !== null) {
        cache.set(key, legacy)
        await secureSet(key, legacy)
        // Deliberate deviation from lastGLANCE, which trusts the resolved
        // write: read the value back before deleting the only other copy.
        // This is the one place where a native layer that lies about success
        // costs a user their WebDAV password and possibly their passphrase.
        const readBack = await secureGet(key)
        if (readBack === legacy) {
          origRemoveItem.call(window.localStorage, key)
        }
        continue
      }
      const value = await secureGet(key)
      if (value !== null) cache.set(key, value)
    } catch {
      // SecureStore unavailable for this key. With legacy plaintext present
      // the cache is already seeded above, so the app behaves exactly as
      // pre-migration; without it there is genuinely nothing to serve.
    }
  }
}

// Test-only: undo the prototype patch and clear module state.
export function uninstallSecureConfigShimForTests() {
  if (!installed) return
  Storage.prototype.getItem = origGetItem
  Storage.prototype.setItem = origSetItem
  Storage.prototype.removeItem = origRemoveItem
  cache.clear()
  pending.clear()
  installed = false
}
