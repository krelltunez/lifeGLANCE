import { createSyncEngine } from '@glance-apps/sync';
import { buildPayload, buildBackupPayload, mergePayloads, makeApplyPayload } from './adapter.js';
import { dbGetAll, dbGetAllChapters } from '../data/db.js';

let engine = null;

export const initSyncEngine = ({ milestonesRef, chaptersRef, setMilestones, setChapters,
  setSyncStatus, setSyncError, setSyncHalted, setLastSynced, setShowPassphraseModal }) => {

  const savedSyncConfig = (() => {
    try { return JSON.parse(localStorage.getItem('lifeglance-cloud-sync-config') || 'null') } catch { return null }
  })()
  const appFolderName = savedSyncConfig?.folder ?? 'GLANCE/lifeglance'

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

    // First-sync conflict: remote has data but this device has never synced.
    // Only keep local (upload) if this device actually has data — otherwise
    // let the engine apply the remote so an empty new device doesn't wipe
    // an existing user's timeline.
    onConflict: async (_remoteData, _lastModified, _etag) => {
      const [localMilestones, localChapters] = await Promise.all([dbGetAll(), dbGetAllChapters()])
      if (localMilestones.length > 0 || localChapters.length > 0) {
        engine?.upload()
      }
    },

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
