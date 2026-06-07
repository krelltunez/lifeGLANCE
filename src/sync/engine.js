import { createSyncEngine } from '@glance-apps/sync';
import { buildPayload, buildBackupPayload, mergePayloads, makeApplyPayload } from './adapter.js';

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

    onStatusChange: (status) => {
      setSyncStatus(status)
      if (status === 'synced' || status === 'idle') setSyncError(null)
    },
    onError: (msg, code, isHardStop) => {
      setSyncError({ message: msg, code, isHardStop });
      if (isHardStop) setSyncHalted(true);
    },
    onLastSyncedChange: setLastSynced,
    onPassphraseRequired: () => setShowPassphraseModal(true),
  });

  return engine;
};

export const getSyncEngine = () => engine;
