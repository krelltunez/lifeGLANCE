import { DB_ROOT_KEY_HOOKS, FILE_SYNC_KEY_HOOKS } from './nativeKeyHooks.js'

// The ONLY sanctioned crypto configs for `@glance-apps/sync` calls. Every call
// that takes a `cryptoDBName` — createSyncEngine, createDbSyncEngine,
// setupEncryptionKey / initSessionKey / clearEncryptionKey (file tier),
// setupDbRootKey (DB tier) — must spread one of these instead of inlining the
// literal. The native key hooks are either/or with IndexedDB inside the
// package (no fallback), so a call site that passes a bare
// `{ cryptoDBName: 'lifeglance-crypto' }` on a native shell writes its key to
// IndexedDB while every hooked call site reads the SecureStore: the symptom is
// a forced passphrase re-prompt (dayGLANCE's shared-slot bug wearing a new
// hat). Where no SecureStore plugin exists (web/PWA) the hook objects are
// empty and these are exactly the old literals.
//
// Two distinct configs because the file tier and the DB tier bind the same
// package hook names to different SecureStore slots — see nativeKeyHooks.js.
export const FILE_CRYPTO_CONFIG = { cryptoDBName: 'lifeglance-crypto', ...FILE_SYNC_KEY_HOOKS }
export const DB_CRYPTO_CONFIG = { cryptoDBName: 'lifeglance-crypto', ...DB_ROOT_KEY_HOOKS }
