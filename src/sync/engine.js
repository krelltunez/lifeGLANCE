import { createSyncEngine } from '@glance-apps/sync';
import { buildPayload, buildBackupPayload, mergePayloads, makeApplyPayload } from './adapter.js';
import { isNativePlatform, nativeWebdavFetch } from './nativeHttp.js';

let engine = null;
// The construction params (ref/setter closures) from App.jsx, kept so the
// engine can be rebuilt in place when a setting that's only read at
// construction time changes. See reinitSyncEngine.
let savedInitParams = null;

const buildEngine = ({ milestonesRef, chaptersRef, setMilestones, setChapters,
  setSyncStatus, setSyncError, setSyncHalted, setLastSynced, setShowPassphraseModal,
  setVaultSkipped }) => {

  const savedSyncConfig = (() => {
    try { return JSON.parse(localStorage.getItem('lifeglance-cloud-sync-config') || 'null') } catch { return null }
  })()
  const appFolderName = savedSyncConfig?.folder ?? 'GLANCE/lifeglance'

  // Pre-seed so the engine always takes the normal CRDT merge path.
  // Without this, the first sync on a new device triggers onConflict which
  // holds the engine lock permanently (no public resolveConflict() exists).
  const KEY_LAST_SYNCED = 'lifeglance-cloud-sync-last-synced'
  if (!localStorage.getItem(KEY_LAST_SYNCED)) {
    localStorage.setItem(KEY_LAST_SYNCED, new Date(Date.now() - 60_000).toISOString())
  }

  return createSyncEngine({
    storageKeyPrefix: 'lifeglance',
    cryptoDBName: 'lifeglance-crypto',
    autoBackupDBName: 'lifeglance-auto-backups',
    syncFilename: 'lifeglance-sync.json',
    appFolderName,
    backupFilenamePrefix: 'lifeglance-backup-',
    appId: 'lifeglance',
    appName: 'lifeGLANCE',

    buildPayload: () => buildPayload(milestonesRef, chaptersRef),
    buildBackupPayload,
    applyPayload: makeApplyPayload(setMilestones, setChapters),
    mergePayloads,

    proxyUrl: import.meta.env.VITE_WEBDAV_PROXY_URL ?? '',

    // On native (Capacitor) shells the WebView enforces CORS and the proxy URL
    // resolves to localhost, so route WebDAV straight through the native HTTP
    // stack. The engine prefers electronProxyFetch over proxyUrl when set, so
    // the browser/PWA build (electronProxyFetch == null) is unchanged.
    electronProxyFetch: isNativePlatform() ? nativeWebdavFetch : null,

    onStatusChange: (status) => {
      setSyncStatus(status)
      if (status === 'success' || status === 'idle') setSyncError(null)
    },
    onError: (msg, code, isHardStop) => {
      // ACCOUNT_ID_REQUIRED (GLANCEvault transport): a sync cycle ran before the
      // account id was populated — a benign startup race. It's retryable and
      // self-heals on the next cycle, so we treat it as "not ready yet" and never
      // surface a scary red error for it.
      if (code === 'ACCOUNT_ID_REQUIRED') {
        if (import.meta.env.DEV) console.debug('[sync] account id not ready yet; will retry next cycle');
        return;
      }
      // The engine calls onError(null, …) to clear a previous error; only treat
      // a real message as an error so the dot doesn't show rose during a sync.
      // Typed codes (KEY_MISMATCH, VERIFIER_UNSUPPORTED) are mapped to friendly,
      // translatable messages at the display layer (CloudSyncModal / TimelineView)
      // via syncErrorText() so the raw crypto/server text is never shown. The
      // engine has already aborted before any upload on a KEY_MISMATCH, so the
      // account is never polluted with poison rows.
      setSyncError(msg ? { message: msg, code, isHardStop } : null);
      if (isHardStop) setSyncHalted(true);
    },
    // Per-row quarantine (GLANCEvault transport): fired once per cycle that
    // skipped undecryptable rows. We call engine.sync() directly (never compose
    // our own pull/push cycle), so this config callback fires for us — we just
    // surface the count. A transient toast + a durable amber note in the sync
    // settings read from this state.
    onRowsSkipped: (count, entityIds) => {
      if (count > 0) {
        setVaultSkipped?.({ count, entityIds: entityIds ?? [], at: Date.now() });
      }
    },
    onLastSyncedChange: setLastSynced,
    onPassphraseRequired: () => setShowPassphraseModal(true),
  });
};

export const initSyncEngine = (params) => {
  savedInitParams = params;
  engine = buildEngine(params);
  return engine;
};

// Rebuild the engine in place, re-reading construction-only config from
// localStorage. The sync folder (appFolderName) is captured when the engine is
// built and never re-read afterwards, so a folder change saved via setConfig has
// no effect until the engine is reconstructed. Calling this right after saving a
// new folder makes it take effect immediately, instead of only after a page
// reload (issue #206). No-op until initSyncEngine has run once.
export const reinitSyncEngine = () => {
  if (!savedInitParams) return engine;
  engine = buildEngine(savedInitParams);
  return engine;
};

export const getSyncEngine = () => engine;
