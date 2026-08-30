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
//
// @glance-apps/sync 2.0.0 added four more, all about the push-on-write path
// (pushNow calls pushDirtyRows directly, so it inherits the primitives' own
// enforcement now instead of bypassing it):
//   • the credential halt refuses the push — same behaviour as before the
//     app-side guard was deleted, reported through a throw rather than a return;
//   • an open push backoff window refuses the push (NEW — lifeGLANCE never had
//     backoff on push-on-write at all);
//   • the declared 'per-page' pull cursor advances between pages and resumes a
//     failed pull from the last good one;
//   • the standing-backoff state and copy the Cloud Sync modal will render from
//     a push-on-write failure.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { describeBackoff, backoffStatusText } from './backoffStatus.js'

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
  const v = {
    async batch(app, { rows: upserts }) {
      for (const r of upserts) { seq += 1; rows.set(r.entityId, { entityId: r.entityId, envelope: r.envelope, deleted: false, seq }) }
      return { written: upserts.length, maxSeq: seq }
    },
    async deleteRow(app, entityId) {
      seq += 1; const prev = rows.get(entityId)
      rows.set(entityId, { entityId, envelope: prev?.envelope, deleted: true, seq })
      return { seq }
    },
    // `pageSize` lets a test force real pagination (several round trips in one
    // pull), which is what the cursor-durability tests below need: a mode that
    // only ever sees a single page would pass under every pullCursorCommit
    // value and prove nothing.
    pageSize: Infinity,
    async list(app, { since }) {
      const out = [...rows.values()].filter(r => r.seq > since).sort((a, b) => a.seq - b.seq)
      const page = out.slice(0, v.pageSize)
      return { rows: page, hasMore: out.length > page.length }
    },
    async getRow(app, entityId) { return rows.get(entityId) ?? null },
    async device() { return { updated: true } },
    async getSalt(accountId) { return salts.get(accountId) ?? null },
    async putSalt(accountId, salt) { if (!salts.has(accountId)) salts.set(accountId, salt); return salts.get(accountId) },
    _rows: rows,
  }
  return v
}

const VAULT_CFG = { vaultEnabled: true, vaultUrl: 'http://vault.test', vaultToken: 'tok', accountId: 'acct-1' }

async function freshModules() {
  vi.resetModules()
  global.indexedDB = new IDBFactory()
  localStorage.clear()
  const db = await import('../data/db.js')
  await db.initDB()
  const milestones = await import('../data/milestones.js')
  const { initDbSyncEngine, getDbSyncEngine, readVaultConfig, clearCredentialHalt } = await import('./dbSync.js')
  const { setSyncPassphrase, setupDbRootKey, isSuppressedError } = await import('@glance-apps/sync')
  return {
    db, milestones, initDbSyncEngine, getDbSyncEngine, readVaultConfig, clearCredentialHalt,
    setSyncPassphrase, setupDbRootKey, isSuppressedError,
  }
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

  // Gap B: a bundle-only edit (categories/birthday/tombstones) must trigger the
  // push-on-write, not just milestone/chapter edits. Marking the categories
  // bundle dirty schedules the debounced vault push and the row reaches the vault.
  it('a category-only edit schedules a vault push (push-on-write for bundles)', async () => {
    const m = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    localStorage.setItem('lifeglance-db-sync-seeded', '1') // skip seed so only the dirty bundle pushes
    localStorage.setItem('lifeglance-categories', JSON.stringify([{ id: 'side', label: 'Side', color: '#FF8800' }]))
    localStorage.setItem('lifeglance-categories-updated-at', new Date(2000).toISOString())
    const vault = makeMemVault()
    m.setSyncPassphrase('pw')
    await m.setupDbRootKey('pw', new Uint8Array(16).fill(8), { cryptoDBName: 'lifeglance-crypto' })
    m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })

    const { markDirty } = await import('./dirty.js')
    const { bundleEntityId } = await import('./entityIds.js')
    const catId = bundleEntityId('categories')

    // A local edit marks the bundle dirty AND schedules a push. Use fake timers
    // so the scheduled push is observed (setTimeout) without firing real crypto
    // under fake time; discard it on useRealTimers (no leak).
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    markDirty(catId)
    expect(setTimeoutSpy).toHaveBeenCalled() // push-on-write scheduled
    expect(JSON.parse(localStorage.getItem('lifeglance-db-sync-dirty'))).toContain(catId) // row marked dirty
    setTimeoutSpy.mockRestore()
    vi.useRealTimers()

    // Flushing the push (what the debounce would do) delivers the bundle row.
    const dbSync = m.getDbSyncEngine()
    await dbSync.pushNow()
    expect(vault._rows.has(catId)).toBe(true)
    expect(vault._rows.get(catId).deleted).toBe(false)
  })

  // Gap A: after a cycle applies bundle values to storage, a sync-applied event
  // fires so component-state UI (categories/birthday in TimelineView) re-reads
  // without an app reload.
  it('a sync dispatches lifeglance:sync-applied so the UI re-reads bundles', async () => {
    const m = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    const vault = makeMemVault()
    m.setSyncPassphrase('pw')
    await m.setupDbRootKey('pw', new Uint8Array(16).fill(8), { cryptoDBName: 'lifeglance-crypto' })
    const dbSync = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })

    const prevWindow = globalThis.window
    globalThis.window = new EventTarget()
    let fired = 0
    globalThis.window.addEventListener('lifeglance:sync-applied', () => { fired += 1 })
    try {
      await dbSync.sync()
    } finally {
      globalThis.window = prevWindow
    }
    expect(fired).toBeGreaterThan(0)
  })

  // The credential halt must gate push-on-write. THE BEHAVIOUR ASSERTED HERE IS
  // UNCHANGED — a halted device makes no push request and keeps its rows dirty —
  // but the REPORTING CHANNEL MOVED in @glance-apps/sync 2.0.0, so this test had
  // to move with it.
  //
  // Before 2.0.0, pushDirtyRows was a raw primitive with no halt guard, so
  // pushNow carried its own isCredentialHalted() check and RETURNED
  // {written: 0, deleted: 0, halted: true} — a shape invented by that app-side
  // guard, not by the engine. 2.0.0 moved enforcement into the primitive, the
  // guard was deleted as redundant, and the engine THROWS instead: a coded
  // CREDENTIAL_INVALID error with halted:true (halted marks it as raised from
  // stored halt state rather than a fresh server rejection, so the halt's
  // timestamp is not rewritten on every refused call).
  //
  // So the old assertion did not break because the behaviour changed. It broke
  // because it was asserting the guard's return value rather than the engine's
  // enforcement. The two load-bearing assertions — no network attempt, rows left
  // dirty — are identical and still here.
  it('push-on-write goes silent under the credential halt', async () => {
    const m = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    const vault = makeMemVault()
    m.setSyncPassphrase('pw')
    await m.setupDbRootKey('pw', new Uint8Array(16).fill(9), { cryptoDBName: 'lifeglance-crypto' })

    let batchCalls = 0
    let reject = true
    const realBatch = vault.batch
    vault.batch = async (app, payload) => {
      batchCalls += 1
      if (reject) {
        const err = new Error("batch upsert failed: 401 — the server rejected this device's credential")
        err.code = 'CREDENTIAL_INVALID'
        err.status = 401
        throw err
      }
      return realBatch(app, payload)
    }

    const dbSync = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
    await m.milestones.addMilestone({ title: 'Doomed write', date: new Date('2021-01-01') })
    await dbSync.sync().catch(() => {})   // cycle hits the coded 401 → engine halts
    expect(dbSync.engine.isCredentialHalted()).toBe(true)

    reject = false                        // server would accept again; the halt is terminal anyway
    const before = batchCalls
    await expect(dbSync.pushNow()).rejects.toMatchObject({ code: 'CREDENTIAL_INVALID', halted: true })
    expect(batchCalls).toBe(before)       // no network attempt from push-on-write
    // Rows are NOT consumed by a refused push: they stay dirty and upload once
    // access is restored via recovery.
    expect(JSON.parse(localStorage.getItem('lifeglance-db-sync-dirty')).length).toBeGreaterThan(0)

    // NEGATIVE CONTROL (in-suite, vacuity check). The assertions above must fail
    // when the halt is absent — otherwise "no network attempt" would pass for a
    // push that simply had nothing to send. Clearing the halt key is the only
    // difference; the same pushNow then reaches the network and succeeds.
    m.clearCredentialHalt()
    expect(dbSync.engine.isCredentialHalted()).toBe(false)
    const res = await dbSync.pushNow()
    expect(batchCalls).toBeGreaterThan(before)   // the request the halt was suppressing
    expect(res.written).toBeGreaterThan(0)
  })

  // NEW IN 2.0.0, AND THE REASON THIS BUMP IS MORE THAN A VERSION NUMBER.
  // pushDirtyRows now refuses to run while the push backoff window is open,
  // rejecting with a typed SYNC_SUPPRESSED *before any network call*. lifeGLANCE
  // never had this on the push-on-write path: pushNow calls the primitive
  // directly, so before 2.0.0 every debounced local edit went out regardless of
  // how recently a push had failed.
  it('push-on-write respects an open push backoff window', async () => {
    const m = await freshModules()
    localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
    const vault = makeMemVault()
    m.setSyncPassphrase('pw')
    await m.setupDbRootKey('pw', new Uint8Array(16).fill(11), { cryptoDBName: 'lifeglance-crypto' })

    let batchCalls = 0
    let failNext = true
    const realBatch = vault.batch
    vault.batch = async (app, payload) => {
      batchCalls += 1
      if (failNext) {
        const err = new Error('fetch failed')
        err.code = 'NETWORK_ERROR'
        throw err
      }
      return realBatch(app, payload)
    }

    const dbSync = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
    await m.milestones.addMilestone({ title: 'First write', date: new Date('2022-01-01') })

    // A failed push-on-write now OPENS the push window itself (the primitive
    // owns the ladder, not just the cycle).
    await expect(dbSync.pushNow()).rejects.toBeTruthy()
    const window = dbSync.engine.getBackoffState().push
    expect(window.until).toBeGreaterThan(Date.now())
    expect(window.reason).toBe('transport')

    // A second local edit while the window stands is REFUSED before the network.
    failNext = false                        // the server would accept now; the window still says no
    const before = batchCalls
    await m.milestones.addMilestone({ title: 'Second write', date: new Date('2022-02-02') })
    const err = await dbSync.pushNow().then(() => null, e => e)
    expect(m.isSuppressedError(err)).toBe(true)
    expect(err.direction).toBe('push')
    expect(err.retryAt).toBeGreaterThan(Date.now())
    expect(batchCalls).toBe(before)         // nothing went out
    // Suppression changes WHEN rows are retried, never WHETHER: both writes are
    // still dirty, and a suppressed call must not extend the window that
    // suppressed it (otherwise an open window feeds itself).
    expect(JSON.parse(localStorage.getItem('lifeglance-db-sync-dirty')).length).toBeGreaterThan(1)
    expect(dbSync.engine.getBackoffState().push.strikes).toBe(window.strikes)

    // NEGATIVE CONTROL (in-suite, vacuity check). With the window lapsed, the
    // very same pushNow reaches the network — so "nothing went out" above is
    // the gate refusing, not an empty dirty set or a broken vault stub. Only
    // Date.now is moved (the engine's isOpen() reads it); no fake timers, which
    // would interfere with the real crypto in the push path.
    const realNow = Date.now
    Date.now = () => realNow.call(Date) + (err.retryInMs + 1000)
    try {
      const res = await dbSync.pushNow()
      expect(batchCalls).toBeGreaterThan(before)
      expect(res.written).toBeGreaterThan(0)
    } finally {
      Date.now = realNow
    }
  })

  // The cursor durability contract (2.0.0 Phase 4b). lifeGLANCE DECLARES
  // 'per-page'; the package default is now 'end-of-pull'. These two tests are
  // the ones that would fail if the declaration were ever dropped — which is the
  // whole point of writing them, since the regression otherwise presents as a
  // network problem rather than a config gap.
  describe('pull cursor durability — the declared per-page mode', () => {
    it('advances the cursor per page across a multi-page pull, not only at the end', async () => {
      const m = await freshModules()
      localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
      const vault = makeMemVault()
      m.setSyncPassphrase('pw')
      await m.setupDbRootKey('pw', new Uint8Array(16).fill(13), { cryptoDBName: 'lifeglance-crypto' })

      // Seed 9 rows on a writer device, then read them back on a fresh one.
      const writer = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
      for (let i = 1; i <= 9; i++) {
        await m.milestones.addMilestone({ title: `Row ${i}`, date: new Date(`2018-0${(i % 9) + 1}-01`) })
      }
      await writer.pushNow()

      const r = await freshModules()
      localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
      localStorage.setItem('lifeglance-db-sync-seeded', '1')  // reader has nothing of its own to push
      r.setSyncPassphrase('pw')
      await r.setupDbRootKey('pw', new Uint8Array(16).fill(13), { cryptoDBName: 'lifeglance-crypto' })

      // Page the vault so one pull needs several round trips, and record the
      // persisted cursor as it stands at the START of each page request.
      vault.pageSize = 3
      const cursorAtEachPage = []
      const realList = vault.list
      vault.list = async (app, args) => {
        cursorAtEachPage.push(Number(localStorage.getItem('lifeglance-db-sync-hwm') || 0))
        return realList.call(vault, app, args)
      }

      const reader = r.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
      await reader.engine.pullRemoteChanges()

      // Under 'per-page' the cursor moves BETWEEN pages. Under the 2.0.0 default
      // this array would be all zeroes — which is exactly the assertion that
      // catches a dropped declaration.
      expect(cursorAtEachPage.length).toBeGreaterThan(1)
      expect(cursorAtEachPage[0]).toBe(0)
      expect(cursorAtEachPage[1]).toBeGreaterThan(0)
      expect(cursorAtEachPage.at(-1)).toBeGreaterThan(cursorAtEachPage[1] - 1)
      vault.list = realList
    })

    it('resumes from the last good page after a mid-pagination failure', async () => {
      const m = await freshModules()
      localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
      const vault = makeMemVault()
      m.setSyncPassphrase('pw')
      await m.setupDbRootKey('pw', new Uint8Array(16).fill(17), { cryptoDBName: 'lifeglance-crypto' })

      const writer = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
      for (let i = 1; i <= 9; i++) {
        await m.milestones.addMilestone({ title: `Row ${i}`, date: new Date(`2017-0${(i % 9) + 1}-01`) })
      }
      await writer.pushNow()

      const r = await freshModules()
      localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
      localStorage.setItem('lifeglance-db-sync-seeded', '1')
      r.setSyncPassphrase('pw')
      await r.setupDbRootKey('pw', new Uint8Array(16).fill(17), { cryptoDBName: 'lifeglance-crypto' })

      vault.pageSize = 3
      let listCalls = 0
      const realList = vault.list
      vault.list = async (app, args) => {
        listCalls += 1
        if (listCalls === 3) {                       // die mid-pagination
          const err = new Error('connection lost')
          err.code = 'NETWORK_ERROR'
          throw err
        }
        return realList.call(vault, app, args)
      }

      const reader = r.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
      await expect(reader.engine.pullRemoteChanges()).rejects.toBeTruthy()

      // The pages that DID land are committed: the cursor sits past them rather
      // than back at the start. Under 'end-of-pull' this would still be 0 and the
      // retry would re-download the whole backlog — the convergence bug 1.10.0
      // fixed and the 2.0.0 default silently reintroduces.
      const resumeFrom = Number(localStorage.getItem('lifeglance-db-sync-hwm') || 0)
      expect(resumeFrom).toBeGreaterThan(0)

      // The failed pull ALSO opened the pull backoff window — 2.0.0 gates both
      // primitives, so an immediate retry is refused before any network call.
      // That is correct and is asserted elsewhere for the push; here it just
      // means the resume has to wait the window out, so move Date.now past it
      // (the engine's isOpen() reads it) rather than using fake timers, which
      // would interfere with the real crypto in the pull path.
      const pullWindow = reader.engine.getBackoffState().pull
      expect(pullWindow.until).toBeGreaterThan(Date.now())
      const realNow = Date.now
      Date.now = () => realNow.call(Date) + (pullWindow.until - realNow.call(Date)) + 1000

      // The retry asks the server to continue from there, not from zero.
      const sinceValues = []
      vault.list = async (app, args) => { sinceValues.push(args.since); return realList.call(vault, app, args) }
      try {
        await reader.engine.pullRemoteChanges()
      } finally {
        Date.now = realNow
        vault.list = realList
      }
      expect(sinceValues[0]).toBe(resumeFrom)
    })
  })

  // WHAT THE CLOUD SYNC MODAL WILL SHOW, from a push-on-write failure.
  //
  // This state is NEW. Before 2.0.0 only the cadence cycle could open a backoff
  // window, so the modal's standing-backoff banner (issue #307) never had a
  // push-on-write failure as its source. Now it does.
  //
  // SCOPE OF THIS TEST, stated rather than implied: it drives a REAL engine to a
  // real push-on-write failure and runs the resulting getBackoffState() through
  // the exact pipeline CloudSyncModal.jsx uses (describeBackoff →
  // backoffStatusText) against the real en/sync.json strings. It verifies the
  // STATE and the COPY. It does NOT mount the component — this repo has no
  // React testing library and tests run in a node environment — so it is not a
  // render test. The banner itself is unchanged code shipped in v3.3.0; only its
  // input source is new. Confirming it paints is one look at a device.
  describe('standing backoff in the Cloud Sync modal, from a push-on-write failure', () => {
    const enStrings = (key, opts) => ({
      backoffTransport: `Can't reach the sync server. Retrying in ${opts?.seconds}s.`,
      backoffAuth: 'The sync server rejected the sign-in. Next retry in about an hour. Check your device token in sync settings.',
      backoffRetrying: 'Retrying on the next sync…',
    }[key])

    const failingPush = async (fill, makeError) => {
      const m = await freshModules()
      localStorage.setItem('lifeglance-cloud-sync-config', JSON.stringify(VAULT_CFG))
      const vault = makeMemVault()
      m.setSyncPassphrase('pw')
      await m.setupDbRootKey('pw', new Uint8Array(16).fill(fill), { cryptoDBName: 'lifeglance-crypto' })
      vault.batch = async () => { throw makeError() }
      const dbSync = m.initDbSyncEngine({ vaultConfig: VAULT_CFG, vaultClient: vault })
      await m.milestones.addMilestone({ title: 'Write that cannot land', date: new Date('2023-03-03') })
      await dbSync.pushNow().catch(() => {})
      return dbSync.engine.getBackoffState()
    }

    it('a transport failure renders the counting-down banner', async () => {
      const state = await failingPush(21, () => Object.assign(new Error('fetch failed'), { code: 'NETWORK_ERROR' }))
      const d = describeBackoff(state, Date.now())
      expect(d).toMatchObject({ reason: 'transport', side: 'push' })
      expect(d.secondsLeft).toBeGreaterThan(0)
      expect(backoffStatusText(enStrings, d)).toMatch(/^Can't reach the sync server\. Retrying in \d+s\.$/)

      // Once the window lapses (the engine clears it only on a SUCCEEDING cycle),
      // the banner stays put and says so rather than vanishing while sync is
      // still unproven.
      const lapsed = describeBackoff(state, d.until + 1000)
      expect(lapsed.secondsLeft).toBe(0)
      expect(backoffStatusText(enStrings, lapsed)).toBe('Retrying on the next sync…')
    })

    it('a 401 renders the flat-hour auth banner, which names the actionable fix', async () => {
      const state = await failingPush(22, () => Object.assign(new Error('invalid device token'), { code: 'AUTH_FAILURE', status: 401 }))
      const d = describeBackoff(state, Date.now())
      expect(d.reason).toBe('auth')
      expect(backoffStatusText(enStrings, d)).toContain('Check your device token in sync settings')
    })

    it('a quota failure stays out of the banner and keeps its own descriptor', async () => {
      const state = await failingPush(23, () => Object.assign(new Error('over quota'), {
        code: 'QUOTA_EXCEEDED', quota: { quota: 'rows', limit: 100, used: 100, requested: 1 },
      }))
      // Excluded by design: the engine re-surfaces QUOTA_EXCEEDED with its
      // descriptor on every cycle, so a second banner would double-report.
      expect(describeBackoff(state, Date.now())).toBeNull()
      expect(state.push.reason).toBe('quota')
    })
  })
})
