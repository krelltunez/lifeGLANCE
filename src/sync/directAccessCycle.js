// One Direct Access cycle: `@glance-apps/sync`'s runSnapshotFileCycle with
// lifeGLANCE's seams filled in. Nothing here touches React; the hook
// (hooks/useDirectAccessSync.js) owns the poll, the in-flight guard and the
// prompts.
//
// The cycle (the seed guard, the content gate, the made-here-or-relayed rule
// with staggered relays, the envelope rules) is the package's and shared with
// dayGLANCE and lastGLANCE; the spec is its docs/SYNC_PACKAGE_SPEC.md,
// "Snapshot-File Cycle". What is this app's, and supplied here:
//
//   • the payload: buildPayload reads IndexedDB, so it is built BEFORE the
//     cycle and handed in as the synchronous thunk the package calls; the
//     same data stands for "local" throughout one cycle. It is the WebDAV
//     engine's own payload (engine.js buildEnginePayload), so the folder
//     carries exactly what WebDAV carries;
//   • the apply: the WebDAV engine's applyEnginePayload. It is async and the
//     package does not await it, so the promise is captured and awaited after
//     the cycle, and the in-flight guard stays up until it settles;
//   • the two device-local stamps: the WebDAV engine's local-modified key, so
//     a change that arrived through the folder is pushed on by WebDAV too, and
//     the local-edit stamp (localEditStamp.js) that tells a change made here
//     from one to relay;
//   • what counts as data: milestones and chapters;
//   • the empty-state guard is moot: the payload IS the store (IndexedDB), so
//     a payload of nothing means a store of nothing, and `localItemCount` is
//     left at its default of zero.

import {
  runSnapshotFileCycle,
  isEncryptedEnvelope,
  decryptData,
  encryptData,
  hasEncryptionReady,
  getSyncPassphrase,
} from '@glance-apps/sync'
import { buildEnginePayload, applyEnginePayload } from './engine.js'
import { mergePayloads as defaultMergePayloads } from './adapter.js'
import { FILE_CRYPTO_CONFIG } from './cryptoConfig.js'
import { lastLocalEditAt as defaultLastLocalEditAt } from './localEditStamp.js'
import { ensureDeviceId } from './dbSync.js'
import { TOMBSTONE_RETENTION_DAYS } from './tombstoneRetention.js'

/** Shared with the WebDAV engine (`${storageKeyPrefix}-cloud-sync-local-modified`): when this device last changed synced data. */
export const LOCAL_MODIFIED_KEY = 'lifeglance-cloud-sync-local-modified'
/** The merge's tombstone horizon, as mergePayloads applies it. */
export const SYNC_RETENTION_DAYS = TOMBSTONE_RETENTION_DAYS
/** The data version the WebDAV file carries (the package's ENVELOPE_DATA_VERSION); the snapshot header says the same. */
export const SNAPSHOT_DATA_VERSION = 2

/** Does a payload carry anything worth restoring: milestones or chapters. */
export function payloadHasData(data) {
  const life = data?.lives?.default
  if (!life || typeof life !== 'object') return false
  const n = (v) => (Array.isArray(v) ? v.length : 0)
  return n(life.milestones) + n(life.chapters) > 0
}

const defaultCrypto = {
  isEncryptedEnvelope,
  decryptData: (envelope) => decryptData(envelope, FILE_CRYPTO_CONFIG),
  encryptData: (payload) => encryptData(payload, FILE_CRYPTO_CONFIG),
  // encryptData derives the key lazily from a passphrase in memory.
  encryptionReady: () => hasEncryptionReady() || !!getSyncPassphrase(),
}

/**
 * @param {object} deps
 * @param {object} deps.transport the Direct Access transport (directAccess.js)
 * @param {() => Promise<object>} [deps.buildPayload]
 * @param {(data: object, opts: { allowEmpty: boolean }) => Promise<void>} [deps.applyPayload]
 * @param {(local: object, remote: object) => { data: object, localChanged: boolean, remoteChanged: boolean }} [deps.mergePayloads]
 * @param {object} [deps.crypto]
 * @param {Storage} [deps.storage]
 * @param {() => string | null} [deps.lastLocalEditAt]
 * @param {() => string} [deps.deviceId]
 * @param {() => number} [deps.now]
 * @param {{ warn: Function, error: Function }} [deps.log]
 * @param {object | null} [state] carried between cycles: the eviction clock, the write throttle stamp and the pending relay
 */
export async function runDirectAccessCycle(deps, state) {
  const {
    transport,
    buildPayload = buildEnginePayload,
    applyPayload = applyEnginePayload,
    mergePayloads = defaultMergePayloads,
    crypto = defaultCrypto,
    storage = localStorage,
    lastLocalEditAt = defaultLastLocalEditAt,
    deviceId = ensureDeviceId,
    now,
    log,
  } = deps

  const data = await buildPayload()
  let applied = null

  const result = await runSnapshotFileCycle({
    transport,
    io: {
      buildSyncPayload: () => ({ version: SNAPSHOT_DATA_VERSION, lastModified: new Date((now ?? Date.now)()).toISOString(), data }),
      applyEngineData: (merged, opts) => { applied = applyPayload(merged, opts) },
      mergeSyncData: (local, remote) => {
        const r = mergePayloads(local, remote)
        return { data: r.data, localChanged: r.localChanged, remoteChanged: r.remoteChanged }
      },
      syncRetentionDays: SYNC_RETENTION_DAYS,
      isEncryptedEnvelope: crypto.isEncryptedEnvelope,
      decryptData: crypto.decryptData,
      encryptData: crypto.encryptData,
      encryptionReady: crypto.encryptionReady,
      storage,
      lastLocalEditAt,
      localModifiedKey: LOCAL_MODIFIED_KEY,
      hasData: payloadHasData,
      deviceId,
      ...(now ? { now } : {}),
      ...(log ? { log } : {}),
    },
    state,
  })
  if (applied) await applied
  return result
}
