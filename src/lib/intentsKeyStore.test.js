// Key-slot separation: the WebDAV file-tier intents key ('intents-root-key') and
// the GLANCEvault intents+blob key ('vault-root-key') live in DISTINCT records so
// they can never collide, plus the one-time migration that re-homes a legacy
// shared-slot vault key on upgrade. Runs against fake-indexeddb (real IDB paths).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { buildEncryptedEnvelope, parseEncryptedEnvelope, SOURCE_APPS, ACTIONS } from '@glance-apps/intents'

if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map()
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  }
}

const INTENTS_CONFIG_KEY = 'lifeglance-intents-config'
const WEBDAV_SALT = new Uint8Array(32).fill(3)
const VAULT_SALT  = new Uint8Array(16).fill(9)

// Fresh IDB + fresh module (module-level key caches reset) per test.
async function fresh() {
  vi.resetModules()
  global.indexedDB = new IDBFactory()
  localStorage.clear()
  const ks = await import('./intentsKeyStore.js')
  const blob = await import('../blobs/blobCrypto.js')
  return { ...ks, deriveBlobKey: blob.deriveBlobKey }
}

const setWebdavIntentsEncryptionOn = () =>
  localStorage.setItem(INTENTS_CONFIG_KEY, JSON.stringify({ enabled: true, webdavUrl: 'https://d', encryptionEnabled: true }))

// A NOTIFY envelope built under `deriveFn`, for round-trip / cross-decrypt checks.
async function encEnvelope(deriveFn) {
  return buildEncryptedEnvelope(
    { action: ACTIONS.NOTIFY, emittedBy: SOURCE_APPS.LIFEGLANCE, eventId: '20260101T000000Z-aaaaaa',
      payload: { event_id: '20260101T000000Z-aaaaaa', source_app: SOURCE_APPS.LIFEGLANCE, source_entity_id: 'm1',
        entity_type: 'goal', event: 'completed', task_id: 'm1', title: 'T', timestamp: '2026-01-01T00:00:00.000Z' } },
    deriveFn,
  )
}

describe('key-slot separation', () => {
  beforeEach(() => localStorage.clear())

  it('WebDAV and vault keys occupy DISTINCT slots — neither clobbers the other', async () => {
    const ks = await fresh()
    // Both encryption tiers on, on the same device (the old collision scenario).
    setWebdavIntentsEncryptionOn()
    const webdavKey = await ks.setupIntentsEncryption('pw', WEBDAV_SALT)   // → intents-root-key
    const vaultKey  = await ks.setupVaultIntentsRootKey('pw', VAULT_SALT)  // → vault-root-key

    // Each slot returns ITS OWN key, unaffected by the other write.
    expect(await ks.loadIntentsRootKey()).toBe(webdavKey)
    expect(await ks.loadVaultIntentsRootKey()).toBe(vaultKey)
    expect(webdavKey).not.toBe(vaultKey)

    // Both keys are usable AND genuinely different material: a vault-key envelope
    // round-trips under the vault key but the WebDAV key cannot decrypt it.
    const env = await encEnvelope(ks.makeDeriveFn(vaultKey))
    const dec = await parseEncryptedEnvelope(env, ks.makeDeriveFn(vaultKey))
    expect(dec.payload.event).toBe('completed')
    await expect(parseEncryptedEnvelope(env, ks.makeDeriveFn(webdavKey))).rejects.toThrow()
  })

  it('setting up the WebDAV key does NOT populate the vault slot', async () => {
    const ks = await fresh()
    setWebdavIntentsEncryptionOn()
    await ks.setupIntentsEncryption('pw', WEBDAV_SALT)
    // Vault slot stays empty — migration must NOT adopt the WebDAV key (see below).
    expect(await ks.loadVaultIntentsRootKey()).toBeNull()
  })
})

describe('bootstrap guard checks the vault slot', () => {
  beforeEach(() => localStorage.clear())

  it('a present WebDAV key does NOT satisfy the vault-key guard (would derive)', async () => {
    const ks = await fresh()
    setWebdavIntentsEncryptionOn()
    await ks.setupIntentsEncryption('pw', WEBDAV_SALT) // WebDAV key present, vault slot empty
    // The bootstrap guard is `if (await loadVaultIntentsRootKey()) return`.
    // With WebDAV-intents encryption on, migration is skipped → vault slot null →
    // the guard is falsy → the bootstrap proceeds to derive the vault key.
    expect(await ks.loadVaultIntentsRootKey()).toBeNull()
  })
})

describe('vault/blob readers read the vault slot', () => {
  beforeEach(() => localStorage.clear())

  it('deriveBlobKey uses the vault slot (not the WebDAV slot)', async () => {
    const ks = await fresh()
    // Only the WebDAV key exists (encryption on) — the blob key must NOT derive
    // from it; the blob reader looks at the vault slot, which is empty.
    setWebdavIntentsEncryptionOn()
    await ks.setupIntentsEncryption('pw', WEBDAV_SALT)
    expect(await ks.deriveBlobKey()).toBeNull()

    // Once the vault key exists, the blob key derives.
    await ks.setupVaultIntentsRootKey('pw', VAULT_SALT)
    expect(await ks.deriveBlobKey()).not.toBeNull()
  })
})

describe('migration for existing (shared-slot) devices', () => {
  beforeEach(() => localStorage.clear())

  it('re-homes a legacy vault key from the shared slot when WebDAV-intents encryption was never enabled', async () => {
    const ks = await fresh()
    // Legacy vault-only device: the OLD code wrote the VAULT-salt key into the
    // shared 'intents-root-key' slot, and WebDAV-intents encryption was never on.
    const legacy = await ks.setupIntentsEncryption('pw', VAULT_SALT) // simulates the legacy shared-slot write
    // (no encryptionEnabled flag → vault-only user)

    // First read of the vault slot migrates the key in — no passphrase needed.
    const migrated = await ks.loadVaultIntentsRootKey()
    expect(migrated).not.toBeNull()
    // Same KEY MATERIAL as the legacy key (IDB structured-clones the CryptoKey on
    // read, so assert functional identity, not reference): a legacy-key envelope
    // decrypts under the migrated key.
    const env = await encEnvelope(ks.makeDeriveFn(legacy))
    const dec = await parseEncryptedEnvelope(env, ks.makeDeriveFn(migrated))
    expect(dec.payload.event).toBe('completed')
    // Blob access is preserved on upgrade.
    expect(await ks.deriveBlobKey()).not.toBeNull()
  })

  it('does NOT adopt the shared slot when WebDAV-intents encryption is on (may be the WebDAV key)', async () => {
    const ks = await fresh()
    setWebdavIntentsEncryptionOn()
    await ks.setupIntentsEncryption('pw', WEBDAV_SALT) // could be the WebDAV key — unsafe to adopt
    expect(await ks.loadVaultIntentsRootKey()).toBeNull()
    expect(await ks.deriveBlobKey()).toBeNull()         // no vault key adopted
  })

  it('migrated key persists across a fresh module load (survives reload, no passphrase)', async () => {
    const first = await fresh()
    const legacy = await first.setupIntentsEncryption('pw', VAULT_SALT)
    await first.loadVaultIntentsRootKey() // triggers migration → writes vault-root-key

    // Simulate a page reload: reset module caches but keep the SAME IndexedDB.
    vi.resetModules()
    const reloaded = await import('./intentsKeyStore.js')
    const afterReload = await reloaded.loadVaultIntentsRootKey()
    expect(afterReload).not.toBeNull()                  // read straight from the vault slot
    // Same underlying material as the legacy key: a legacy-key envelope decrypts.
    const env = await encEnvelope(first.makeDeriveFn(legacy))
    const dec = await parseEncryptedEnvelope(env, reloaded.makeDeriveFn(afterReload))
    expect(dec.payload.event).toBe('completed')
  })
})
