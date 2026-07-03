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

import { createDbSyncEngine, getSyncPassphrase } from '@glance-apps/sync'
import { makeDbAdapter } from './dbAdapter.js'
import { makeRealStore } from './dbStore.js'
import { registerDirtyTarget } from './dirty.js'
import { dbGetAll, dbGetAllChapters } from '../data/db.js'
import { loadCategories } from '../utils/colors.js'
import { loadVaultIntentsRootKey, setupVaultIntentsRootKey } from '../lib/intentsKeyStore.js'
import { flushOutbox } from '../lib/intentsTransport.js'

const CONFIG_KEY     = 'lifeglance-cloud-sync-config'
const DEVICE_ID_KEY  = 'lifeglance-db-sync-device-id'
const SEEDED_KEY     = 'lifeglance-db-sync-seeded'

let _dbEngine = null
let _pushTimer = null
// Cached init options (the React setters App passes at mount) so the engine can
// be re-initialised IN PLACE from anywhere — e.g. the settings modal activating
// vault sync — without a page reload and without re-plumbing the setters.
let _lastOpts = {}

export const getDbSyncEngine = () => _dbEngine

// Re-read the vault config and rebuild the engine in place using the cached
// options. Returns the new engine (or null if vault is now disabled). Used after
// the credential UI saves a freshly-verified config.
export const reinitDbSyncEngine = () => initDbSyncEngine(_lastOpts)

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
  // Cache the durable wiring (React setters etc.) so reinitDbSyncEngine() can
  // rebuild later without them being re-passed. Explicit one-shot test deps
  // (vaultConfig/vaultClient/store) are NOT cached so a later reinit re-reads the
  // real config.
  const { vaultConfig: _vc, vaultClient: _vcl, store: _st, ...durable } = opts
  _lastOpts = { ..._lastOpts, ...durable }

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

  // HWM=0 full-snapshot seed: on first activation, mark every entity this device
  // already holds dirty so a brand-new vault device uploads its whole state. The
  // pull cursor defaults to 0, so it also pulls everything the account has.
  const seedSnapshot = async () => {
    if (localStorage.getItem(SEEDED_KEY) === '1') return
    for (const id of await adapter.allEntityIds()) engine.markDirty(id)
    localStorage.setItem(SEEDED_KEY, '1')
  }

  // Blob/intents key late-bootstrap — the missing twin of the DB key's bootstrap.
  //
  // The DB-sync root key gets a late bootstrap inside the engine: on first
  // sync/push, ensureRootKey establishes the per-account salt (getSalt, or
  // register a fresh one via putSalt) and derives the DB key from the session
  // passphrase + that salt. A device that first set up on the UNINITIALIZED
  // path (fresh household, no salt yet) never ran vaultSetup's SUCCESS-path
  // derivation, so its blob/intents key — which shares the same passphrase +
  // salt foundation — would otherwise stay null forever, and blob encryption
  // (and, once wired, intents) would fail on that device.
  //
  // This gives the blob/intents key the SAME late bootstrap at the SAME moment:
  // once the engine cycle has established the salt, derive it against the REAL
  // vault salt (never an invented one) using the same session passphrase the DB
  // key derivation used. Idempotent — a no-op once the key exists (the SUCCESS
  // path already ran, or a previous first-sync already bootstrapped it), so it
  // never re-derives or clobbers. Non-fatal: a failure here (e.g. a transient
  // getSalt) is retried on the next cycle and never breaks a succeeded sync.
  const bootstrapIntentsRootKey = async () => {
    try {
      // Guard on the VAULT slot (not the WebDAV slot): a present WebDAV-intents key
      // must NOT make us skip deriving the vault key. loadVaultIntentsRootKey also
      // runs the one-time migration that re-homes a legacy shared-slot vault key.
      if (await loadVaultIntentsRootKey()) return       // vault key already present — no-op
      const passphrase = getSyncPassphrase()
      if (!passphrase) return                           // no passphrase → cannot derive (DB key couldn't either)
      const salt = await engine.vault.getSalt(vaultConfig.accountId)
      if (!salt || !salt.length) return                 // salt not established yet — try again next cycle
      await setupVaultIntentsRootKey(passphrase, salt)  // derive against the REAL vault salt → vault slot
      // The vault intents key just appeared — flush any intents the outbox held
      // (vault target 'transient' on key-not-ready) so a freshly-bootstrapped
      // device delivers them promptly rather than waiting for the next UI poll.
      try {
        await flushOutbox()
      } catch (e) {
        console.warn('[dbsync] intents flush after key setup deferred', e)
      }
    } catch (err) {
      console.warn('[dbsync] blob/intents key bootstrap deferred', err)
    }
  }

  // Post-cycle React refresh (the state bridge described above).
  const refresh = async () => {
    const [ms, ch] = await Promise.all([dbGetAll(), dbGetAllChapters()])
    opts.setMilestones?.(ms)
    opts.setChapters?.(ch)
    opts.setCategories?.(loadCategories())
    opts.setBirthday?.(localStorage.getItem('lifeglance-birthday') || '')
    // Nudge UI that reads categories/birthday straight from storage to re-read
    // after a merge applied new bundle values. milestones/chapters refresh via
    // the setters above; categories/birthday live in component state (TimelineView)
    // and re-read on this event, so a synced bundle shows without an app reload.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('lifeglance:sync-applied'))
      window.dispatchEvent(new Event('lifeglance:widget-refresh'))
    }
  }

  const sync = async () => {
    await seedSnapshot()
    const r = await engine.sync()
    await bootstrapIntentsRootKey()   // salt is now established — give the blob/intents key its late bootstrap
    await refresh()
    return r
  }

  // Vault-only push (no pull), used by the debounced push-on-write so a local
  // edit reaches the vault promptly even on a backgrounded device. This also
  // runs ensureRootKey (salt establishment), so bootstrap the blob/intents key
  // here too — a backgrounded first write can establish the salt before any
  // full sync does.
  const pushNow = async () => {
    await seedSnapshot()
    const r = await engine.pushDirtyRows()
    await bootstrapIntentsRootKey()
    return r
  }
  const pushDebounced = (ms = 4000) => {
    clearTimeout(_pushTimer)
    _pushTimer = setTimeout(() => { pushNow().catch(err => console.warn('[dbsync] push failed', err)) }, ms)
  }

  // Register the dirty target so EVERY local write (not just milestone/chapter
  // edits) both marks its row dirty and schedules a vault push. Without the push
  // nudge, a category/birthday/tombstone-only edit would mark dirty but wait for
  // the 60s cycle to upload — and could miss it entirely if the app backgrounds
  // first. Routing the push through markDirty makes push-on-write uniform across
  // all entity types.
  registerDirtyTarget({ markDirty: (id) => { engine.markDirty(id); pushDebounced() } })

  _dbEngine = { engine, sync, pushNow, pushDebounced, seedSnapshot, refresh, markDirty: engine.markDirty }
  return _dbEngine
}
