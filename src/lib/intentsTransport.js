// WebDAV transport for the @glance-apps/intents protocol.
// Handles config persistence, event file emission, and polling for inbound events.

import {
  buildEnvelope,
  buildEncryptedEnvelope,
  parseEnvelope,
  parseEncryptedEnvelope,
  filenameFor,
  eventId as makeEventId,
  SOURCE_APPS,
  ACTIONS,
  EVENTS,
  NoKeyError,
  WrongKeyError,
  MalformedEnvelopeError,
} from '@glance-apps/intents'
import { loadIntentsRootKey, setupIntentsEncryption, makeDeriveFn } from './intentsKeyStore.js'
import { isNativePlatform, nativeWebdavResponse } from '../sync/nativeHttp.js'
import { enqueue, flush } from './intentsOutbox.js'
import { isVaultIntentsEnabled, makeVaultDeliverer } from './intentsVaultTransport.js'

const CONFIG_KEY = 'lifeglance-intents-config'
const CURSOR_KEY = 'lifeglance-intents-cursor'
const SALT_FILENAME = 'intents-encryption-salt.json'

export const DEFAULT_CONFIG = {
  enabled:           false,
  webdavUrl:         '',   // https://cloud.example.com/remote.php/dav/files/user
  webdavUser:        '',
  webdavPass:        '',
  eventsPath:        '/GLANCE/events/',
  pollIntervalMin:   2,
  encryptionEnabled: false,
}

// Proxy URL from the build env — same Vercel function used by the sync layer.
const PROXY_URL = import.meta.env.VITE_WEBDAV_PROXY_URL ?? '/api/webdav-proxy'

export function loadIntentsConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveIntentsConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
}

export function isIntegrationEnabled() {
  const cfg = loadIntentsConfig()
  return cfg.enabled && !!cfg.webdavUrl.trim()
}

function loadCursor() {
  return localStorage.getItem(CURSOR_KEY) ?? ''
}

function saveCursor(cursor) {
  localStorage.setItem(CURSOR_KEY, cursor)
}

// Builds the full target URL for a path inside the events directory.
function targetUrl(cfg, filename = '') {
  const base = cfg.webdavUrl.replace(/\/$/, '')
  const dir  = cfg.eventsPath.endsWith('/') ? cfg.eventsPath : cfg.eventsPath + '/'
  return `${base}${dir}${filename}`
}

// Routes a fetch through the shared Vercel proxy (X-WebDAV-Url header).
// On native shells, hits the WebDAV server directly via the native HTTP stack
// (the WebView enforces CORS and the proxy URL resolves to localhost).
function proxyFetch(cfg, filename, method, extraHeaders = {}, body) {
  const target = targetUrl(cfg, filename)
  const authHeader = cfg.webdavUser
    ? { Authorization: 'Basic ' + btoa(`${cfg.webdavUser}:${cfg.webdavPass}`) }
    : {}

  if (isNativePlatform()) {
    return nativeWebdavResponse(method, target, { ...authHeader, ...extraHeaders }, body)
  }

  if (PROXY_URL) {
    return fetch(PROXY_URL, {
      method,
      headers: { ...authHeader, ...extraHeaders, 'X-WebDAV-Url': target },
      body,
    })
  }
  return fetch(target, { method, headers: { ...authHeader, ...extraHeaders }, body })
}

// PUT a JSON envelope as a new event file in the WebDAV events directory.
async function putEventFile(cfg, envelope) {
  const res = await proxyFetch(
    cfg,
    filenameFor(envelope),
    'PUT',
    { 'Content-Type': 'application/json' },
    JSON.stringify(envelope),
  )
  if (!res.ok) {
    const err = new Error(`WebDAV PUT failed: ${res.status} ${res.statusText}`)
    err.status = res.status   // let the deliverer map 5xx/429/408 → transient, other 4xx → permanent
    throw err
  }
}

// PROPFIND the events directory and return a sorted list of .json filenames.
async function listEventFiles(cfg) {
  let res
  try {
    res = await proxyFetch(
      cfg, '', 'PROPFIND',
      { 'Depth': '1', 'Content-Type': 'application/xml' },
      '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
    )
  } catch (err) {
    err.transient = true
    throw err
  }
  if (!res.ok) {
    const err = new Error(`PROPFIND failed: ${res.status}`)
    err.transient = res.status >= 500
    throw err
  }
  const text = await res.text()
  const EVENT_FILE_RE = /(\d{8}T\d{6}Z-[0-9a-f]+\.json)/g
  const matches = [...text.matchAll(EVENT_FILE_RE)]
  return [...new Set(matches.map(m => m[1]))].sort()
}

// GET a single event file and parse it. Throws { transient: true } on network / 5xx errors.
async function getEventFile(cfg, filename) {
  let res
  try {
    res = await proxyFetch(cfg, filename, 'GET')
  } catch (err) {
    err.transient = true
    throw err
  }
  if (!res.ok) {
    const err = new Error(`GET ${filename} failed: ${res.status}`)
    err.transient = res.status >= 500
    throw err
  }
  return res.json()
}

// ── Encryption salt management ────────────────────────────────────────────────

// Reads the shared root salt from the events directory. Returns null if absent.
async function loadSharedSalt(cfg) {
  let res
  try {
    res = await proxyFetch(cfg, SALT_FILENAME, 'GET')
  } catch {
    return null
  }
  if (res.status === 404) return null
  if (!res.ok) return null
  try {
    const json = await res.json()
    // Salt is stored as a base64 string
    const bin = atob(json.salt)
    return Uint8Array.from(bin, c => c.charCodeAt(0))
  } catch {
    return null
  }
}

// Writes a new shared root salt to the events directory.
async function writeSharedSalt(cfg, saltBytes) {
  const b64 = btoa(String.fromCharCode(...saltBytes))
  const res = await proxyFetch(
    cfg, SALT_FILENAME, 'PUT',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ salt: b64 }),
  )
  if (!res.ok) throw new Error(`Failed to write shared salt: ${res.status}`)
}

// Sets up intents encryption for this device. Reads or creates the shared salt,
// derives the root key from the passphrase, and persists it to IDB.
export async function enableIntentsEncryption(passphrase) {
  const cfg = loadIntentsConfig()
  if (!cfg.enabled || !cfg.webdavUrl.trim()) throw new Error('Integration not configured')

  let saltBytes = await loadSharedSalt(cfg)
  if (!saltBytes) {
    // First app to enable encryption — generate and publish the shared salt.
    saltBytes = crypto.getRandomValues(new Uint8Array(32))
    await writeSharedSalt(cfg, saltBytes)
  }

  await setupIntentsEncryption(passphrase, saltBytes)
  saveIntentsConfig({ ...cfg, encryptionEnabled: true })
}

// ── WebDAV deliverer (file tier) ──────────────────────────────────────────────
//
// The outbox calls this at flush time. It is a thin durable wrapper over the
// EXISTING WebDAV write (proxyFetch → putEventFile) and keeps that tier's
// EXISTING encryption policy unchanged (encrypt iff the config has
// encryptionEnabled — the file tier may legitimately carry plaintext; the vault
// tier may not). It never throws to signal an expected failure.

async function buildOutboundEnvelope(args) {
  const cfg = loadIntentsConfig()
  if (cfg.encryptionEnabled) {
    const rootKey = await loadIntentsRootKey()
    if (!rootKey) throw new Error('[intents] encryption enabled but key not set up on this device (setup_incomplete)')
    const deriveFn = makeDeriveFn(rootKey)
    return buildEncryptedEnvelope(args, deriveFn)
  }
  return buildEnvelope(args)
}

// Deliver one raw intent over WebDAV. 'delivered' | 'transient' | 'permanent'.
export async function deliverToWebdav(intent) {
  const cfg = loadIntentsConfig()
  if (!cfg.enabled || !cfg.webdavUrl.trim()) return 'permanent' // not configured — won't self-heal
  let envelope
  try {
    envelope = await buildOutboundEnvelope({
      eventId:   intent.event_id,   // stable id → filename + idempotency across retries
      emittedBy: intent.emitted_by,
      action:    intent.action,
      payload:   intent.payload,
    })
  } catch {
    // encryption enabled but the file-tier key isn't cached yet → transient
    // (hold; never a silent plaintext fallback).
    return 'transient'
  }
  try {
    await putEventFile(cfg, envelope)
    return 'delivered'
  } catch (err) {
    const s = err?.status
    if (s !== undefined && s < 500 && s !== 429 && s !== 408) return 'permanent' // other 4xx
    return 'transient' // network / 5xx / 429 / 408
  }
}

// ── Emit: build the RAW intent, enqueue durably, flush ────────────────────────

// Raw intents ({ event_id, action, payload, emitted_by }) — NEVER envelopes. The
// event_id is stamped NOW and flows unchanged through every retry (outbox id AND
// server idempotency key). Envelope construction + encryption happen at flush
// inside each deliverer.

function buildRawCreateIntent(milestone) {
  const evtId = makeEventId()
  return {
    event_id:   evtId,
    emitted_by: SOURCE_APPS.LIFEGLANCE,
    action:     ACTIONS.CREATE,
    payload: {
      title:            milestone.title,
      due:              milestone.date,
      source_app:       SOURCE_APPS.LIFEGLANCE,
      source_entity_id: milestone.id,
      entity_type:      'goal',
      notes:            milestone.note || undefined,
    },
  }
}

function buildRawNotifyIntent(milestone, event, extra = {}) {
  const evtId = makeEventId()
  return {
    event_id:   evtId,
    emitted_by: SOURCE_APPS.LIFEGLANCE,
    action:     ACTIONS.NOTIFY,
    payload: {
      event_id:         evtId,
      source_app:       SOURCE_APPS.LIFEGLANCE,
      source_entity_id: milestone.id,
      entity_type:      'goal',
      event,
      task_id:          milestone.dayglance_task_id || milestone.id,
      title:            milestone.title,
      timestamp:        new Date().toISOString(),
      due:              milestone.date,
      ...extra,
    },
  }
}

// The set of enabled transports for an emitted intent. WebDAV and the vault are
// independent, opt-in ALONGSIDE each other — an intent goes to whichever are on.
export function computeIntentTargets() {
  const targets = []
  if (isIntegrationEnabled()) targets.push('webdav')
  if (isVaultIntentsEnabled()) targets.push('vault')
  return targets
}

// Deliverers for the currently-enabled transports (a target with no deliverer
// this flush is left untouched by the outbox — not attempted, not counted).
export function buildIntentDeliverers() {
  const deliverers = {}
  if (isIntegrationEnabled())  deliverers.webdav = deliverToWebdav
  if (isVaultIntentsEnabled()) deliverers.vault  = makeVaultDeliverer()
  return deliverers
}

// Flush the durable outbox through the enabled deliverers. Best-effort; the
// in-flight lock collapses overlapping triggers into one drain.
export async function flushOutbox(opts = {}) {
  return flush(buildIntentDeliverers(), opts)
}

// Durable enqueue of one raw intent, then a best-effort flush. Resolves ONLY
// after the outbox write has committed — so a caller's change-marker (e.g. the
// "sent" activity entry) advances only AFTER durable enqueue; a failed enqueue
// rejects and the marker is not advanced. Returns the event_id, or null when no
// transport is enabled (nothing to send).
async function emitIntent(rawIntent) {
  const targets = computeIntentTargets()
  if (targets.length === 0) return null
  await enqueue(rawIntent, targets) // DURABLE before we resolve
  // Fire-and-forget flush; if it fails the poll cadence / app-start flush retry.
  flushOutbox().catch(err => console.warn('[intents] flush after enqueue failed:', err))
  return rawIntent.event_id
}

// Emit an outbound `create` to dayGLANCE for a milestone the user wants tracked.
export async function emitCreateForMilestone(milestone) {
  return emitIntent(buildRawCreateIntent(milestone))
}

// Emit an outbound `notify` for any state change on a linked milestone.
export async function emitStateNotify(milestone, event, extra = {}) {
  if (!milestone.dayglance_linked) return null
  return emitIntent(buildRawNotifyIntent(milestone, event, extra))
}

// Emit an outbound `notify` when a linked milestone's date changes.
export async function emitRescheduledNotify(milestone, previousDue) {
  return emitStateNotify(milestone, EVENTS.RESCHEDULED, { previous_due: previousDue })
}

// ── Poller ────────────────────────────────────────────────────────────────────

// Polls the WebDAV events directory for new events since the last cursor.
// Advances the cursor only on definitive outcomes; holds on transient errors.
export async function pollEvents(onEvent) {
  const cfg = loadIntentsConfig()
  if (!cfg.enabled || !cfg.webdavUrl.trim()) return

  // Load root key once for the whole poll cycle.
  const rootKey  = cfg.encryptionEnabled ? await loadIntentsRootKey() : null
  const deriveFn = makeDeriveFn(rootKey)

  const cursor = loadCursor()
  let files
  try {
    files = await listEventFiles(cfg)
  } catch (err) {
    if (err.transient) return
    console.warn('[intents] PROPFIND failed (non-transient):', err)
    return
  }

  // Exclude the salt metadata file from event processing.
  const toProcess = (cursor
    ? files.filter(f => f.replace('.json', '') > cursor.replace('.json', ''))
    : files
  ).filter(f => f !== SALT_FILENAME)


  let lastProcessed = cursor
  for (const filename of toProcess) {
    let envelope
    try {
      const raw = await getEventFile(cfg, filename)
      if (raw.encrypted === true) {
        if (!deriveFn) {
          console.warn('[intents] skipping encrypted event (no_root_key):', filename)
          lastProcessed = filename
          continue
        }
        envelope = await parseEncryptedEnvelope(raw, deriveFn)
      } else {
        envelope = parseEnvelope(raw)
      }
    } catch (err) {
      if (err.transient) break
      if (err instanceof NoKeyError || err instanceof WrongKeyError) {
        console.warn('[intents] skipping event — key mismatch:', filename, err.name)
        lastProcessed = filename
        continue
      }
      if (err instanceof MalformedEnvelopeError) {
        console.warn('[intents] skipping malformed event file:', filename, err)
        lastProcessed = filename
        continue
      }
      console.warn('[intents] skipping event file:', filename, err)
      lastProcessed = filename
      continue
    }

    try {
      await onEvent(envelope)
    } catch (err) {
      console.warn('[intents] handler error for:', filename, err)
    }
    lastProcessed = filename
  }

  if (lastProcessed && lastProcessed !== cursor) {
    saveCursor(lastProcessed)
  }
}
