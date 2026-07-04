// Fresh-household blob/intents key late-bootstrap (dbSync.js).
//
// The DB-sync root key gets a late bootstrap inside the engine: on first
// sync/push, ensureRootKey establishes the per-account salt and derives the DB
// key from the session passphrase. A device that first set up on the
// UNINITIALIZED path (fresh household, no salt yet) never ran vaultSetup's
// SUCCESS-path setupIntentsEncryption, so WITHOUT this fix its blob/intents key
// — which shares the same passphrase + salt foundation — would stay null
// forever and blob encryption would fail on that device.
//
// These tests drive the REAL createDbSyncEngine through initDbSyncEngine over an
// in-memory vault and assert:
//   • fresh-household (uninitialized) setup + first-sync salt-establishment
//     leaves a NON-NULL blob/intents key (so encryptBlob would succeed);
//   • an already-initialized (SUCCESS-path) device is unaffected — its key is
//     neither re-derived nor clobbered;
//   • the bootstrap is idempotent across repeated first-syncs.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

// Minimal localStorage for the node test environment.
if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map()
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  }
}

// One shared in-memory vault. Starts with NO salt (a fresh household); the
// engine's ensureRootKey registers one on first use via putSalt (first-write-wins).
function makeMemVault() {
  const rows = new Map()
  let seq = 0
  const salts = new Map()
  return {
    async batch(app, { rows: upserts }) {
      for (const r of upserts) { seq += 1; rows.set(r.entityId, { entityId: r.entityId, envelope: r.envelope, deleted: false, seq }) }
      return { written: upserts.length, maxSeq: seq }
    },
    async deleteRow(app, entityId) {
      seq += 1; const prev = rows.get(entityId)
      rows.set(entityId, { entityId, envelope: prev?.envelope, deleted: true, seq })
      return { seq }
    },
    async list(app, { since }) {
      const out = [...rows.values()].filter(r => r.seq > since).sort((a, b) => a.seq - b.seq)
      return { rows: out, hasMore: false }
    },
    async getRow(app, entityId) { return rows.get(entityId) ?? null },
    async device() { return { updated: true } },
    async getSalt(accountId) { return salts.get(accountId) ?? null },
    async putSalt(accountId, salt) { if (!salts.has(accountId)) salts.set(accountId, salt); return salts.get(accountId) },
    _salts: salts,
  }
}

const VAULT_CFG = { vaultEnabled: true, vaultUrl: 'http://vault.test', vaultToken: 'tok', accountId: 'acct-1' }

async function freshModules() {
  vi.resetModules()
  global.indexedDB = new IDBFactory()
  localStorage.clear()
  const db = await import('../data/db.js')
  await db.initDB()
  const { initDbSyncEngine } = await import('./dbSync.js')
  const { loadVaultIntentsRootKey, setupVaultIntentsRootKey } = await import('../lib/intentsKeyStore.js')
  const { deriveBlobKey } = await import('../blobs/blobCrypto.js')
  const { setSyncPassphrase, clearDbRootKey } = await import('@glance-apps/sync')
  // @glance-apps/sync is externalized (native ESM), so vi.resetModules does NOT
  // reset its in-memory DB root key. Clear it so each test starts as a genuine
  // fresh device (hasDbRootKey false → ensureRootKey establishes the salt).
  clearDbRootKey()
  return { db, initDbSyncEngine, loadVaultIntentsRootKey, setupVaultIntentsRootKey, deriveBlobKey, setSyncPassphrase }
}

describe('fresh-household blob/intents key late-bootstrap', () => {
  beforeEach(() => { localStorage.clear() })

  it('uninitialized setup + first sync → non-null blob/intents key (encryptBlob would succeed)', async () => {
    const m = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    const vault = makeMemVault()
    // Fresh household: passphrase is set (as vaultSetup does on the UNINITIALIZED
    // path) but NO salt exists yet and NO key has been derived — the SUCCESS-path
    // setupVaultIntentsRootKey never ran.
    m.setSyncPassphrase('pw')
    expect(await m.loadVaultIntentsRootKey()).toBeNull()   // no blob/intents key yet
    expect(vault._salts.size).toBe(0)                 // no salt established yet

    const dbSync = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
    await dbSync.sync()   // ensureRootKey establishes the salt + DB key; bootstrap derives the blob/intents key

    // The salt is now established AND the blob/intents key exists…
    expect(vault._salts.has('acct-1')).toBe(true)
    const rootKey = await m.loadVaultIntentsRootKey()
    expect(rootKey).not.toBeNull()
    // …so the blob key derives — encryptBlob would succeed on this device.
    expect(await m.deriveBlobKey()).not.toBeNull()
  })

  it('already-initialized (SUCCESS-path) device: key present, not re-derived or clobbered', async () => {
    const m = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    const vault = makeMemVault()
    m.setSyncPassphrase('pw')
    // Emulate the SUCCESS path having already derived the blob/intents key
    // (against the vault-fetched salt) before the engine ever syncs.
    await m.setupVaultIntentsRootKey('pw', new Uint8Array(16).fill(9))
    const keyBefore = await m.loadVaultIntentsRootKey()
    expect(keyBefore).not.toBeNull()

    const dbSync = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
    await dbSync.sync()

    // The pre-existing key is preserved verbatim — idempotent no-op, no clobber.
    expect(await m.loadVaultIntentsRootKey()).toBe(keyBefore)
  })

  it('idempotent across repeated first-syncs (never re-derives once established)', async () => {
    const m = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    const vault = makeMemVault()
    m.setSyncPassphrase('pw')

    const dbSync = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
    await dbSync.sync()
    const key1 = await m.loadVaultIntentsRootKey()
    expect(key1).not.toBeNull()

    await dbSync.sync()   // repeated sync must NOT re-derive/clobber
    const key2 = await m.loadVaultIntentsRootKey()
    expect(key2).toBe(key1)
  })

  it('push-on-write also bootstraps the key when it establishes the salt first', async () => {
    const m = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    const vault = makeMemVault()
    m.setSyncPassphrase('pw')
    // A real push-on-write carries a dirty row — pushDirtyRows early-returns
    // (before ensureRootKey) when nothing is dirty, so seed a local write.
    const milestones = await import('../data/milestones.js')
    await milestones.addMilestone({ title: 'Backgrounded write', date: new Date('2020-01-01') })

    const dbSync = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
    await dbSync.pushNow()   // push-on-write path also runs ensureRootKey → establishes salt

    expect(vault._salts.has('acct-1')).toBe(true)
    expect(await m.loadVaultIntentsRootKey()).not.toBeNull()
  })
})

// The upgrade case: vault DB sync runs from a cached DB key, so the passphrase is
// often absent this session and the vault intents/blob key (new in 2.6.0) never
// gets derived. When the user has actually selected vault intents, prompt for the
// passphrase (once) so the key can be derived rather than failing silently with
// KeyUnavailableError. We seed a cached DB root key (setupDbRootKey → hasDbRootKey
// true) so the engine's own sync does NOT itself demand the passphrase — exactly
// the state of an already-syncing device that just upgraded.
describe('vault intents key — passphrase prompt when it cannot be derived', () => {
  const INTENTS_VAULT_ACTIVE = JSON.stringify({ enabled: true, transport: 'vault', webdavUrl: '' })

  // Seed a cached DB root key so ensureRootKey is satisfied without a session
  // passphrase, then clear the passphrase — the "sync works from cache, but the
  // passphrase isn't in this session" upgrade state.
  async function seedCachedDbKeyNoPassphrase(m) {
    const { setupDbRootKey } = await import('@glance-apps/sync')
    await setupDbRootKey('pw', new Uint8Array(16).fill(7), { cryptoDBName: 'lifeglance-crypto' })
    m.setSyncPassphrase(null)
  }

  it('prompts once when the key is missing, no passphrase is in session, and vault intents is active', async () => {
    const m = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    localStorage.setItem('lifeglance-intents-config', INTENTS_VAULT_ACTIVE)
    await seedCachedDbKeyNoPassphrase(m)
    expect(await m.loadVaultIntentsRootKey()).toBeNull()   // intents key was never derived

    const onPassphraseRequired = vi.fn()
    const vault = makeMemVault()
    const dbSync = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault, onPassphraseRequired })

    await dbSync.sync()   // sync works off the cached DB key; bootstrap hits the no-passphrase branch
    await dbSync.sync()   // a later cycle must NOT re-open the modal

    expect(onPassphraseRequired).toHaveBeenCalledTimes(1)
    expect(await m.loadVaultIntentsRootKey()).toBeNull()  // still no key — it needs the passphrase
  })

  it('does NOT prompt when vault intents is not the selected transport', async () => {
    const m = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    // No intents config → isVaultIntentsActive() is false (vault sync alone must not nag).
    await seedCachedDbKeyNoPassphrase(m)

    const onPassphraseRequired = vi.fn()
    const vault = makeMemVault()
    const dbSync = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault, onPassphraseRequired })
    await dbSync.sync()

    expect(onPassphraseRequired).not.toHaveBeenCalled()
  })

  it('does not prompt when the passphrase is available — it derives the key instead', async () => {
    const m = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    localStorage.setItem('lifeglance-intents-config', INTENTS_VAULT_ACTIVE)
    m.setSyncPassphrase('pw')

    const onPassphraseRequired = vi.fn()
    const vault = makeMemVault()
    const dbSync = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault, onPassphraseRequired })
    await dbSync.sync()

    expect(onPassphraseRequired).not.toHaveBeenCalled()
    expect(await m.loadVaultIntentsRootKey()).not.toBeNull()
  })
})
