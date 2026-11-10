// The Lives gate (v5.0): multi-Life data only when every device that has synced
// in the last WRITER_WINDOW_DAYS runs v5.0 (sync schema 2).
// docs/lifeGLANCE-app-spec.md, "Sync and version skew".
//
// Both sync tiers report the writers they see here:
//   • a stamped vault row, or a file `writers` entry → that device, its schema
//   • an unstamped vault row pulled after this device's first full pull, or a
//     file whose `writers` map lost this device's own entry → a device older
//     than Phase 1 ("legacy"), whose identity cannot be known
// A writer blocks while it was seen within the window and its schema is below
// 2. This device never blocks itself.

import { WRITER_WINDOW_DAYS } from './writerStamp.js'
import { ensureDeviceId } from './deviceId.js'

/** The sync schema a device needs for multi-Life data. */
export const LIVES_SCHEMA = 2

const SEEN_KEY = 'lifeglance-sync-writers-seen'
const DAY_MS = 24 * 60 * 60 * 1000

/** Writer keys for devices older than Phase 1, which carry no identity. */
export const LEGACY_VAULT = 'legacy:vault'
export const legacyFileKey = (fileKey) => `legacy:file:${fileKey}`

const hasStorage = () => typeof localStorage !== 'undefined'

export function writersSeen() {
  if (!hasStorage()) return {}
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') } catch { return {} }
}

/**
 * Note that `key` wrote at `seenAt` (ms) with this schema. Keeps the latest
 * sighting per key; an older sighting never replaces a newer one.
 */
export function recordWriter(key, { schema, app = null, platform = null } = {}, seenAt = Date.now()) {
  if (!key || !hasStorage() || !Number.isFinite(seenAt)) return
  const seen = writersSeen()
  const prev = seen[key]
  if (prev && prev.seenAt >= seenAt) return
  seen[key] = { schema: Number.isInteger(schema) ? schema : 0, app, platform, seenAt }
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
}

/** Writers that keep multi-Life data off, newest first. */
export function blockingWriters(now = Date.now(), ownDevice = safeDeviceId()) {
  return Object.entries(writersSeen())
    .filter(([key, w]) => key !== ownDevice && w.schema < LIVES_SCHEMA && now - w.seenAt <= WRITER_WINDOW_DAYS * DAY_MS)
    .map(([key, w]) => ({ key, legacy: key.startsWith('legacy:'), ...w }))
    .sort((a, b) => b.seenAt - a.seenAt)
}

export const canUseMultipleLives = (now = Date.now()) => blockingWriters(now).length === 0

export class MultipleLivesBlockedError extends Error {
  constructor(blocking) {
    super('Another device that synced recently runs an older lifeGLANCE; update it to add Lives')
    this.name = 'MultipleLivesBlockedError'
    this.blocking = blocking
  }
}

function safeDeviceId() {
  try { return ensureDeviceId() } catch { return null }
}
