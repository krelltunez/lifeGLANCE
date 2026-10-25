// Zero-config iCloud sync (docs/icloud-sync.md), dayGLANCE's iCloud tier
// (src/sync/icloudSnapshotTransport.js, src/utils/icloudSyncPref.js) and
// lastGLANCE's src/sync/icloud.ts, over this app's Direct Access cycle
// (sync/directAccessCycle.js) and hook (hooks/useSnapshotFileSync.js):
// lifeglance-sync.json in the app's own iCloud container. What is iCloud's:
//
//   • ON by default on iOS, with nothing to set up, and a per-device switch.
//     The preference is tri-state (absent = on, 'true', 'false') because a
//     reinstall turns iOS's per-app iCloud toggle back on while the container
//     file survives: a fresh install that finds iCloud data and holds none of
//     its own is asked before anything is restored (firstRunDecided), and the
//     answer is what the switch then shows.
//   • Plaintext. iCloud Drive is encrypted by Apple at rest and in transit,
//     so the encrypt switch does not apply, and an envelope a file somehow
//     holds is decrypted once with the cached key and written back plain
//     (`allowsPlaintextReseed`).
//   • A download that stalls past ICLOUD_DOWNLOAD_GRACE_MS is read from the
//     last downloaded copy, so this device's edits are not held hostage.
//   • "Data" is milestones and chapters (payloadHasData), as for the folder;
//     a fresh native install starts empty, so that alone decides the question.

import { icloudBridge } from '../native/icloud.js'

export const ICLOUD_POLL_MS = 15 * 1000
/** The daemon's round trip takes ~5-10 s; writing faster piles up conflict versions. */
export const ICLOUD_WRITE_THROTTLE_MS = 5 * 1000
export const ICLOUD_DOWNLOAD_GRACE_MS = 2 * 60 * 1000
export const ICLOUD_SYNC_FILE = 'lifeglance-sync.json'
export const ICLOUD_LAST_SYNCED_KEY = 'lifeglance-icloud-last-synced'
/** 'true' | 'false' | absent. Absent means ON and the first-run question not yet answered. */
export const ICLOUD_SYNC_PREF_KEY = 'lifeglance-icloud-sync-enabled'

const defaultStorage = () => (typeof localStorage === 'undefined' ? null : localStorage)

/** The raw decision: null when the user has not chosen. */
export function getICloudSyncPref(storage = defaultStorage) {
  try {
    const v = storage()?.getItem(ICLOUD_SYNC_PREF_KEY) ?? null
    return v === 'true' || v === 'false' ? v : null
  } catch { return null }
}

/** Absence is ON: zero-config is the default and must stay it. */
export function isICloudSyncEnabled(storage = defaultStorage) {
  return getICloudSyncPref(storage) !== 'false'
}

/** Records the decision; recording true also marks the first-run question answered. */
export function setICloudSyncEnabled(enabled, storage = defaultStorage) {
  try { storage()?.setItem(ICLOUD_SYNC_PREF_KEY, enabled ? 'true' : 'false') } catch { /* this session still follows it */ }
}

/** The shell's classification onto the string contract the shared cycle reads. */
const readToText = (r) => {
  switch (r?.kind) {
    case 'absent': return null
    case 'downloading': return JSON.stringify({ downloading: true })
    case 'text': return r.text ?? ''
    default: return JSON.stringify({ error: r?.error ?? 'iCloud unavailable' })
  }
}

/**
 * @param {object} [deps]
 * @param {() => object | null} [deps.bridge]
 * @param {() => Storage | null} [deps.storage]
 * @param {() => number} [deps.now]
 * @param {number} [deps.downloadGraceMs]
 * @param {{ warn: Function }} [deps.log]
 */
export function createICloudTransport({
  bridge = icloudBridge,
  storage = defaultStorage,
  now = Date.now,
  downloadGraceMs = ICLOUD_DOWNLOAD_GRACE_MS,
  log = console,
} = {}) {
  const isEnabled = () => isICloudSyncEnabled(storage)
  // The first consecutive read that found the copy downloading, or null.
  let downloadingSince = null

  return {
    id: 'icloud',
    pollMs: ICLOUD_POLL_MS,
    writeThrottleMs: ICLOUD_WRITE_THROTTLE_MS,
    lastSyncedKey: ICLOUD_LAST_SYNCED_KEY,
    allowsPlaintextReseed: true,
    encryptsWrites: () => false,
    firstRunDecided: () => getICloudSyncPref(storage) !== null,

    isSupported: () => !!bridge(),
    // Re-probed every cycle rather than cached: iCloud Drive switched off
    // mid-session must go quiet, and come back by itself when it returns.
    isAvailable: async () => {
      const b = bridge()
      return !!b && isEnabled() && (await b.available())
    },
    isEnabled,
    setEnabled: (enabled) => setICloudSyncEnabled(enabled, storage),

    read: async () => {
      const b = bridge()
      if (!b) return JSON.stringify({ error: 'no iCloud' })
      const fresh = await b.read(ICLOUD_SYNC_FILE)
      if (fresh.kind !== 'downloading') { downloadingSince = null; return readToText(fresh) }
      const t = now()
      if (downloadingSince === null) downloadingSince = t
      if (t - downloadingSince < downloadGraceMs) return readToText(fresh)
      // Stalled past the window: merge into the last downloaded copy, if any.
      const stale = await b.read(ICLOUD_SYNC_FILE, { allowStale: true })
      if (stale.kind !== 'text') return readToText(fresh)
      log.warn(`[icloud] download stalled ${Math.round((t - downloadingSince) / 1000)} s; merging into the last downloaded copy`)
      return readToText(stale)
    },
    write: async (text) => (await bridge()?.write(ICLOUD_SYNC_FILE, text, { atomic: true })) === true,

    onChanged: (cb) => bridge()?.onChanged(cb) ?? (() => {}),
  }
}

/** The app's one iCloud transport. */
export const icloudTransport = createICloudTransport()
