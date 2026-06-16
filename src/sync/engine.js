import { createSyncEngine } from '@glance-apps/sync';
import { buildPayload, buildBackupPayload, mergePayloads, makeApplyPayload } from './adapter.js';
import { isNativePlatform, nativeWebdavFetch } from './nativeHttp.js';

let engine = null;

export const initSyncEngine = ({ milestonesRef, chaptersRef, setMilestones, setChapters,
  setSyncStatus, setSyncError, setSyncHalted, setLastSynced, setShowPassphraseModal }) => {

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

  engine = createSyncEngine({
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
      // The engine calls onError(null, …) to clear a previous error; only treat
      // a real message as an error so the dot doesn't show rose during a sync.
      setSyncError(msg ? { message: msg, code, isHardStop } : null);
      if (isHardStop) setSyncHalted(true);
    },
    onLastSyncedChange: setLastSynced,
    onPassphraseRequired: () => setShowPassphraseModal(true),
  });

  return engine;
};

export const getSyncEngine = () => engine;
