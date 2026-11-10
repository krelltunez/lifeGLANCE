// Writer stamps: which app version wrote what, on every sync tier (Lives Phase 1).
//
// Lives v5.0 turns on multi-Life data only when every device that has synced in
// the last WRITER_WINDOW_DAYS runs v5.0 (docs/lifeGLANCE-app-spec.md, "Sync and
// version skew"). It can only know that if each write says who made it. This
// release adds that, and changes nothing about how data is stored.
//
// ── GLANCEvault rows ────────────────────────────────────────────────────────
// The stamp rides in the envelope's `life_id`. That field never identified a
// Life (it was always 'default'), and it is the ONE envelope field a 4.0.x
// client never echoes: 4.0.x strips it on apply and writes the plain string
// 'default' on every push. Any other place would leak: 4.0.x keeps every other
// envelope key in the stored record and re-pushes it on its next edit, so a
// row edited on an old device would still carry a newer device's stamp and the
// old device would be invisible. So:
//   life_id === 'default' (string)  → written by a client older than this one
//   life_id is an object            → a stamp: { set, schema, device, app, platform }
// A 4.0.x client re-pushes a chapter once when it first sees a stamped row
// (its own equality check compares life_id with 'default'); that echo is
// unstamped and converges on the next pull.
//
// ── File tier (WebDAV, iCloud, Direct Access) ───────────────────────────────
// A top-level `writers` map: deviceId → { schema, app, platform, day }. `day` is
// the UTC date of the device's latest build of the payload, so the map changes
// at most once a day per device and an idle device does not rewrite the file.
// A 4.0.x client drops every top-level key it does not know, so a file whose
// `writers` map has vanished was last written by a 4.0.x client.

import { Capacitor } from '@capacitor/core'

/** The sync schema this build writes: 1 from Phase 1 (4.x), 2 from Lives v5.0. */
export const SYNC_SCHEMA = 2

/** How long a device counts as "recently active" for the v5.0 gate. */
export const WRITER_WINDOW_DAYS = 60

/** The data set every row belongs to (the old `life_id` value). */
export const DATA_SET = 'default'

const NEWER_WRITER_KEY = 'lifeglance-newer-writer'
const DAY_MS = 24 * 60 * 60 * 1000

/* global __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

const platform = () => {
  try { return Capacitor.getPlatform() } catch { return 'web' }
}

const utcDay = (now) => new Date(now).toISOString().slice(0, 10)

// ── Vault envelope ──────────────────────────────────────────────────────────

/** The `life_id` value this device writes on every pushed row. */
export function rowStamp(deviceId) {
  return { set: DATA_SET, schema: SYNC_SCHEMA, device: deviceId ?? null, app: APP_VERSION, platform: platform() }
}

/** A row's stamp, or null for an unstamped (pre-Phase-1) row. */
export function readRowStamp(lifeId) {
  if (!lifeId || typeof lifeId !== 'object' || Array.isArray(lifeId)) return null
  return Number.isInteger(lifeId.schema) ? lifeId : null
}

// ── File-tier writers map ───────────────────────────────────────────────────

/** This device's entry for the payload's `writers` map. */
export function ownWriterEntry(now = Date.now()) {
  return { schema: SYNC_SCHEMA, app: APP_VERSION, platform: platform(), day: utcDay(now) }
}

const isEntry = (e) => e && typeof e === 'object' && typeof e.day === 'string'

/**
 * Union of two writers maps: per device the entry with the later day wins (a
 * same-day tie goes to the larger serialization, so both sides agree), and
 * entries older than the window are dropped. Commutative, so every device
 * computes the same map from the same two inputs.
 */
export function mergeWriters(a, b, now = Date.now()) {
  const cutoff = utcDay(now - WRITER_WINDOW_DAYS * DAY_MS)
  const out = {}
  for (const src of [a, b]) {
    if (!src || typeof src !== 'object') continue
    for (const [device, entry] of Object.entries(src)) {
      if (!isEntry(entry) || entry.day < cutoff) continue
      const cur = out[device]
      if (!cur || entry.day > cur.day ||
          (entry.day === cur.day && JSON.stringify(entry) > JSON.stringify(cur))) {
        out[device] = entry
      }
    }
  }
  return Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]))
}

// ── "A newer version wrote here" ────────────────────────────────────────────

const hasStorage = () => typeof localStorage !== 'undefined'

/**
 * Note a stamp (row stamp or writers entry) if it comes from a newer schema.
 * The newest one seen is kept, with when it was last seen, and a
 * 'lifeglance:newer-writer' event tells the UI.
 */
export function noteWriter(entry, now = Date.now()) {
  if (!entry || !Number.isInteger(entry.schema) || entry.schema <= SYNC_SCHEMA || !hasStorage()) return
  // Only a live record counts: one older than the window is replaced, and the
  // UI hears about it again as if for the first time.
  const prev = readNewerWriter(now)
  const record = {
    schema: Math.max(entry.schema, prev?.schema ?? 0),
    app: entry.schema >= (prev?.schema ?? 0) ? (entry.app ?? null) : prev.app,
    platform: entry.schema >= (prev?.schema ?? 0) ? (entry.platform ?? null) : prev.platform,
    seenAt: new Date(now).toISOString(),
  }
  localStorage.setItem(NEWER_WRITER_KEY, JSON.stringify(record))
  if (!prev && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lifeglance:newer-writer', { detail: record }))
  }
}

/** The newer-version record if one was seen within the window, else null. */
export function readNewerWriter(now = Date.now()) {
  if (!hasStorage()) return null
  try {
    const rec = JSON.parse(localStorage.getItem(NEWER_WRITER_KEY) || 'null')
    if (!rec || !(rec.schema > SYNC_SCHEMA)) return null
    if (now - new Date(rec.seenAt).getTime() > WRITER_WINDOW_DAYS * DAY_MS) return null
    return rec
  } catch { return null }
}
