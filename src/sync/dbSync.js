// GLANCEvault database sync engine wiring for lifeGLANCE (Stage 2 Part B).
//
// Constructed ALONGSIDE the existing WebDAV file-tier engine (engine.js), never
// replacing it: the file tier is left completely untouched and vault sync is
// opt-in. initDbSyncEngine returns null whenever the vault is not configured, so
// a build with no vault credentials behaves exactly as before.
//
// Cycle ordering (B3): the engine default is push-then-pull. @glance-apps/sync
// 1.5.2 splits the cursor into a push-ack marker and a separate pull cursor, so
// a push can no longer advance `since` past unread remote rows — the historical
// reason apps wrapped the cycle in pull-then-push is gone. lifeGLANCE adds NO
// such wrapper. It DOES wrap sync() in a thin post-cycle state refresh, because
// applyRemoteEntity writes applied rows straight to IDB/localStorage (bypassing
// React); the refresh reloads React state so the UI reflects merged rows. That
// is a state bridge, not a cursor bridge.

import { createDbSyncEngine } from '@glance-apps/sync'
import { makeDbAdapter } from './dbAdapter.js'
import { makeRealStore } from './dbStore.js'
import { registerDirtyTarget } from './dirty.js'
import { dbGetAll, dbGetAllChapters } from '../data/db.js'
import { loadCategories } from '../utils/colors.js'

const CONFIG_KEY     = 'lifeglance-cloud-sync-config'
const DEVICE_ID_KEY  = 'lifeglance-db-sync-device-id'
const SEEDED_KEY     = 'lifeglance-db-sync-seeded'

let _dbEngine = null
let _pushTimer = null

export const getDbSyncEngine = () => _dbEngine

// Reads vault settings from the existing cloud-sync config (additive optional
// fields). Returns null unless the vault is explicitly enabled AND all three of
// vaultUrl / vaultToken / accountId are present and non-empty.
export const readVaultConfig = () => {
  let cfg
  try { cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null') } catch { return null }
  if (!cfg || cfg.vaultEnabled !== true) return null
  const vaultUrl   = (cfg.vaultUrl   || '').trim()
  const vaultToken = (cfg.vaultToken || '').trim()
  const accountId  = (cfg.accountId  || '').trim()
  if (!vaultUrl || !vaultToken || !accountId) return null
  return { vaultUrl, vaultToken, accountId }
}

// Stable per-device id (persisted once), so the server-side device cursor tracks
// this device across reloads.
const ensureDeviceId = () => {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

/**
 * Constructs the DB sync engine if the vault is configured, else returns null.
 *
 * @param {object} opts
 * @param {object} [opts.vaultConfig]  - { vaultUrl, vaultToken, accountId }; read from config if omitted
 * @param {object} [opts.store]        - store override (tests); defaults to the real IDB/localStorage store
 * @param {object} [opts.vaultClient]  - pre-built vault client (tests)
 * @param {string} [opts.cryptoDBName]
 * @param {Function} [opts.setMilestones] @param {Function} [opts.setChapters]
 * @param {Function} [opts.setCategories] @param {Function} [opts.setBirthday]
 * @param {Function} [opts.onStatusChange] @param {Function} [opts.onError] @param {Function} [opts.onRowsSkipped]
 * @param {Function} [opts.fetchImpl]
 */
export const initDbSyncEngine = (opts = {}) => {
  const vaultConfig = opts.vaultConfig ?? readVaultConfig()
  if (!vaultConfig) { _dbEngine = null; registerDirtyTarget(null); return null }

  const store = opts.store ?? makeRealStore()
  // Late-bound markDirty: the adapter's re-push-superset path needs the engine's
  // markDirty, but the engine isn't built yet. Forward through a holder.
  const holder = { markDirty: () => {} }
  const adapter = makeDbAdapter({ store, markDirty: (id) => holder.markDirty(id) })

  const engine = createDbSyncEngine({
    storageKeyPrefix: 'lifeglance',
    appId: 'lifeglance',
    vaultApp: 'lifeglance',
    vaultUrl:   vaultConfig.vaultUrl,
    vaultToken: vaultConfig.vaultToken,
    accountId:  vaultConfig.accountId,
    deviceId:   ensureDeviceId(),
    cryptoDBName: opts.cryptoDBName ?? 'lifeglance-crypto',
    vaultClient: opts.vaultClient,
    fetchImpl: opts.fetchImpl,

    getLocalEntity:        adapter.getLocalEntity,
    applyRemoteEntity:     adapter.applyRemoteEntity,
    applyRemoteDelete:     adapter.applyRemoteDelete,
    isInsertOnly:          adapter.isInsertOnly,
    getEntityLastModified: adapter.getEntityLastModified,

    onStatusChange: opts.onStatusChange,
    onError:        opts.onError,
    onRowsSkipped:  opts.onRowsSkipped,
  })

  holder.markDirty = engine.markDirty
  registerDirtyTarget({ markDirty: engine.markDirty })

  // HWM=0 full-snapshot seed: on first activation, mark every entity this device
  // already holds dirty so a brand-new vault device uploads its whole state. The
  // pull cursor defaults to 0, so it also pulls everything the account has.
  const seedSnapshot = async () => {
    if (localStorage.getItem(SEEDED_KEY) === '1') return
    for (const id of await adapter.allEntityIds()) engine.markDirty(id)
    localStorage.setItem(SEEDED_KEY, '1')
  }

  // Post-cycle React refresh (the state bridge described above).
  const refresh = async () => {
    const [ms, ch] = await Promise.all([dbGetAll(), dbGetAllChapters()])
    opts.setMilestones?.(ms)
    opts.setChapters?.(ch)
    opts.setCategories?.(loadCategories())
    opts.setBirthday?.(localStorage.getItem('lifeglance-birthday') || '')
    // Nudge UI that reads categories/birthday straight from storage (settings,
    // widget) to re-read after a merge applied new bundle values.
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('lifeglance:widget-refresh'))
  }

  const sync = async () => {
    await seedSnapshot()
    const r = await engine.sync()
    await refresh()
    return r
  }

  // Vault-only push (no pull), used by the debounced push-on-write so a local
  // edit reaches the vault promptly even on a backgrounded device.
  const pushNow = async () => {
    await seedSnapshot()
    return engine.pushDirtyRows()
  }
  const pushDebounced = (ms = 4000) => {
    clearTimeout(_pushTimer)
    _pushTimer = setTimeout(() => { pushNow().catch(err => console.warn('[dbsync] push failed', err)) }, ms)
  }

  _dbEngine = { engine, sync, pushNow, pushDebounced, seedSnapshot, refresh, markDirty: engine.markDirty }
  return _dbEngine
}
