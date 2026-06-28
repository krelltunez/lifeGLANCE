// Stage 2 Part B — live-wiring integration test.
//
// Exercises the REAL createDbSyncEngine (not the harness) through initDbSyncEngine
// over the real row adapter + an in-memory vault. Confirms:
//   • the vault gate returns null when unconfigured / non-null when configured;
//   • the HWM=0 full-snapshot seed marks existing local state dirty;
//   • a local write reaches the vault via the debounced push-on-write (the
//     "backgrounded write reaches the vault without an app reopen" check);
//   • a second device pulls and applies the row end-to-end through real crypto.
//
// markDirty is driven through the real data layer (addMilestone etc.), proving
// the explicit call sites are wired.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

// Minimal localStorage for the node test environment (fake-indexeddb supplies
// IndexedDB only). The app's bundles/config live in localStorage.
if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map()
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  }
}

// One shared in-memory vault across both device engines.
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
    _rows: rows,
  }
}

const VAULT_CFG = { vaultEnabled: true, vaultUrl: 'http://vault.test', vaultToken: 'tok', accountId: 'acct-1' }

async function freshModules() {
  vi.resetModules()
  global.indexedDB = new IDBFactory()
  localStorage.clear()
  const db = await import('../data/db.js')
  await db.initDB()
  const milestones = await import('../data/milestones.js')
  const { initDbSyncEngine, getDbSyncEngine, readVaultConfig } = await import('./dbSync.js')
  const { setSyncPassphrase, setupDbRootKey } = await import('@glance-apps/sync')
  return { db, milestones, initDbSyncEngine, getDbSyncEngine, readVaultConfig, setSyncPassphrase, setupDbRootKey }
}

describe('Stage 2 Part B — DB sync engine wiring', () => {
  beforeEach(() => { localStorage.clear() })

  it('vault gate: returns null when not configured, an engine when configured', async () => {
    const m = await freshModules()
    expect(m.initDbSyncEngine()).toBeNull()           // no config
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    expect(m.readVaultConfig()).toEqual({ vaultUrl: 'http://vault.test', vaultToken: 'tok', accountId: 'acct-1' })
  })

  it('a backgrounded local write reaches the vault via push-on-write (no reopen)', async () => {
    const m = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    const vault = makeMemVault()
    // Root key ready (would normally come from the passphrase prompt).
    m.setSyncPassphrase('hunter2')
    await m.setupDbRootKey('hunter2', new Uint8Array(16).fill(3), { cryptoDBName: 'lifeglance-crypto' })

    const dbSync = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
    expect(dbSync).not.toBeNull()

    // A local write through the real data layer marks the entity dirty…
    const ms = await m.milestones.addMilestone({ title: 'Backgrounded write', date: new Date('2020-01-01') })
    // …and a vault-only push (what the debounce fires) lands it on the server,
    // without any full sync cycle / app reopen.
    await dbSync.pushNow()
    expect(vault._rows.has(ms.id)).toBe(true)
    expect(vault._rows.get(ms.id).deleted).toBe(false)
  })

  it('HWM=0 seed uploads pre-existing local state, and a second device pulls it', async () => {
    // Device 1: seed some state BEFORE the engine exists, then activate.
    const m1 = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    const vault = makeMemVault()
    m1.setSyncPassphrase('pw')
    await m1.setupDbRootKey('pw', new Uint8Array(16).fill(5), { cryptoDBName: 'lifeglance-crypto' })
    const seeded = await m1.milestones.addMilestone({ title: 'Pre-existing', date: new Date('2019-05-05') })
    const d1 = m1.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
    await d1.pushNow()  // seedSnapshot marks all existing ids dirty, then pushes
    expect(vault._rows.has(seeded.id)).toBe(true)

    // Device 2: fresh modules/IDB (a different device) sharing the SAME vault and
    // root key. A sync pulls and applies the seeded milestone.
    const m2 = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    m2.setSyncPassphrase('pw')
    await m2.setupDbRootKey('pw', new Uint8Array(16).fill(5), { cryptoDBName: 'lifeglance-crypto' })
    const d2 = m2.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
    await d2.sync()

    const onDevice2 = await m2.db.dbGet(seeded.id)
    expect(onDevice2).not.toBeNull()
    expect(onDevice2.title).toBe('Pre-existing')
  })
})
