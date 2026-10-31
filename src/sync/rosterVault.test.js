// The household roster on GLANCEvault (glance-users), lifeGLANCE's side: a
// pull-only copy. A sibling app (dayGLANCE or lastGLANCE, played here by a real
// createDbSyncEngine on glance-users) writes members; lifeGLANCE's own vault
// cycle pulls them through real crypto under the account's shared root key,
// keeps them apart from its own data, and never writes the roster back.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map()
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  }
}

// An in-memory vault that keeps each app's rows apart, as the server does.
function makeAppVault() {
  const apps = new Map()
  const rowsOf = (app) => { if (!apps.has(app)) apps.set(app, new Map()); return apps.get(app) }
  let seq = 0
  const salts = new Map()
  const writes = []
  return {
    async batch(app, { rows: upserts }) {
      for (const r of upserts) { seq += 1; writes.push(app); rowsOf(app).set(r.entityId, { entityId: r.entityId, envelope: r.envelope, deleted: false, seq }) }
      return { written: upserts.length, maxSeq: seq }
    },
    async deleteRow(app, entityId) {
      seq += 1; writes.push(app)
      const prev = rowsOf(app).get(entityId)
      rowsOf(app).set(entityId, { entityId, envelope: prev?.envelope, deleted: true, seq })
      return { seq }
    },
    async list(app, { since }) {
      return { rows: [...rowsOf(app).values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq), hasMore: false }
    },
    async getRow(app, entityId) { return rowsOf(app).get(entityId) ?? null },
    async device() { return { updated: true } },
    async getSalt(accountId) { return salts.get(accountId) ?? null },
    async putSalt(accountId, salt) { if (!salts.has(accountId)) salts.set(accountId, salt); return salts.get(accountId) },
    rowsOf,
    writes,
  }
}

const VAULT_CFG = { vaultEnabled: true, vaultUrl: 'http://vault.test', vaultToken: 'tok', accountId: 'acct-1' }
const SALT = new Uint8Array(16).fill(7)
const T1 = '2026-10-01T10:00:00.000Z'
const T2 = '2026-10-02T10:00:00.000Z'

async function freshModules() {
  vi.resetModules()
  global.indexedDB = new IDBFactory()
  localStorage.clear()
  const db = await import('../data/db.js')
  await db.initDB()
  const dbSync = await import('./dbSync.js')
  const roster = await import('./rosterVault.js')
  const sync = await import('@glance-apps/sync')
  return { dbSync, roster, sync }
}

// The sibling app's engine on glance-users, over a plain in-memory roster.
function siblingApp(sync, vault, members) {
  const engine = sync.createDbSyncEngine({
    storageKeyPrefix: 'sibling-glance-users',
    appId: 'glance-users',
    vaultApp: 'glance-users',
    vaultUrl: VAULT_CFG.vaultUrl,
    vaultToken: VAULT_CFG.vaultToken,
    accountId: VAULT_CFG.accountId,
    deviceId: 'sibling-device',
    cryptoDBName: 'sibling-crypto',
    vaultClient: vault,
    pullCursorCommit: 'per-page',
    getLocalEntity: async (id) => members.get(id) ?? null,
    applyRemoteEntity: async (id, e) => { members.set(id, e) },
    applyRemoteDelete: async (id) => { members.delete(id) },
    isInsertOnly: () => false,
    getEntityLastModified: (e) => e?.updatedAt,
  })
  return engine
}

describe('household roster on GLANCEvault (glance-users), lifeGLANCE side', () => {
  beforeEach(() => { localStorage.clear() })

  it("pulls a sibling app's members through the lifeGLANCE cycle, and never writes the roster", async () => {
    const m = await freshModules()
    const vault = makeAppVault()
    m.sync.setSyncPassphrase('pw')
    await m.sync.setupDbRootKey('pw', SALT, { cryptoDBName: 'sibling-crypto' })
    await m.sync.setupDbRootKey('pw', SALT, { cryptoDBName: 'lifeglance-crypto' })
    await vault.putSalt(VAULT_CFG.accountId, SALT)

    const members = new Map([
      ['u1', { id: 'u1', name: 'Jason', updatedAt: T1 }],
      ['u2', { id: 'u2', name: 'Maggie', updatedAt: T1 }],
    ])
    const sibling = siblingApp(m.sync, vault, members)
    sibling.markDirty('u1'); sibling.markDirty('u2')
    await sibling.dbSyncCycle()
    expect(vault.rowsOf('glance-users').has('u1') && vault.rowsOf('glance-users').has('u2')).toBe(true)
    const rosterWrites = () => vault.writes.filter((a) => a === 'glance-users').length
    const afterSibling = rosterWrites()

    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    const life = m.dbSync.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
    await life.sync()
    expect(m.roster.getHouseholdRoster().map((u) => u.name)).toEqual(['Jason', 'Maggie'])
    expect(rosterWrites()).toBe(afterSibling)

    // A rename and a removal in the sibling app reach lifeGLANCE too.
    members.set('u1', { id: 'u1', name: 'Jay', updatedAt: T2 })
    sibling.markDirty('u1')
    members.delete('u2')
    sibling.markDirty('u2')
    await sibling.dbSyncCycle()
    const afterEdits = rosterWrites()
    await life.sync()
    expect(m.roster.getHouseholdRoster()).toEqual([{ id: 'u1', name: 'Jay', updatedAt: T2 }])

    // lifeGLANCE wrote nothing to glance-users, and none of the roster leaked
    // into its own app.
    expect(rosterWrites()).toBe(afterEdits)
    expect(vault.rowsOf('lifeglance').has('u1')).toBe(false)
  })

  it('keeps a newer copy and ignores a malformed or mismatched row', () => {
    const s = { m: new Map(), getItem(k) { return this.m.get(k) ?? null }, setItem(k, v) { this.m.set(k, v) } }
    return import('./rosterVault.js').then((r) => {
      expect(r.applyRosterEntity(s, 'u1', { id: 'u1', name: 'Maggie', updatedAt: T2 })).toBe(true)
      expect(r.applyRosterEntity(s, 'u1', { id: 'u1', name: 'Old', updatedAt: T1 })).toBe(false)
      expect(r.applyRosterEntity(s, 'u1', { id: 'u2', name: 'Wrong', updatedAt: T2 })).toBe(false)
      expect(r.applyRosterEntity(s, 'u3', { id: 'u3', name: ' ', updatedAt: T2 })).toBe(false)
      expect(r.applyRosterDelete(s, 'u1', () => T2)).toBe(true)
      expect(r.getHouseholdRoster(s)).toEqual([])
      expect(r.applyRosterEntity(s, 'u1', { id: 'u1', name: 'Maggie', updatedAt: '2026-10-05T00:00:00.000Z' })).toBe(true)
      expect(r.getHouseholdRoster(s).map((u) => u.name)).toEqual(['Maggie'])
    })
  })

  it('stands down on a server without glance-users, without failing the cycle', async () => {
    const r = await import('./rosterVault.js')
    let cycles = 0
    const eng = r.createRosterEngine(VAULT_CFG, {
      storage: { getItem: () => null, setItem: () => {} },
      createEngine: (cfg) => ({ sync: async () => { cycles += 1; cfg.onError('list failed: 400') } }),
    })
    expect(await eng.sync()).toBe(false)
    expect(await eng.sync()).toBe(false)
    expect(cycles).toBe(1)
  })
})
