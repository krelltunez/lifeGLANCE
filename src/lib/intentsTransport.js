// WebDAV transport for the @glance-apps/intents protocol.
// Handles config persistence, event file emission, and polling for inbound events.

import {
  buildEnvelope,
  buildEncryptedEnvelope,
  parseEnvelope,
  parseEncryptedEnvelope,
  filenameFor,
  SOURCE_APPS,
  ACTIONS,
  EVENTS,
  NoKeyError,
  WrongKeyError,
  MalformedEnvelopeError,
} from '@glance-apps/intents'
import { loadIntentsRootKey, setupIntentsEncryption, makeDeriveFn } from './intentsKeyStore.js'

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
function proxyFetch(cfg, filename, method, extraHeaders = {}, body) {
  const target = targetUrl(cfg, filename)
  const authHeader = cfg.webdavUser
    ? { Authorization: 'Basic ' + btoa(`${cfg.webdavUser}:${cfg.webdavPass}`) }
    : {}

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
  if (!res.ok) throw new Error(`WebDAV PUT failed: ${res.status} ${res.statusText}`)
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

// ── Emit helpers ──────────────────────────────────────────────────────────────

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

// Emit an outbound `create` to dayGLANCE for a milestone the user wants tracked.
export async function emitCreateForMilestone(milestone) {
  const cfg = loadIntentsConfig()
  if (!cfg.enabled || !cfg.webdavUrl.trim()) return
  const envelope = await buildOutboundEnvelope({
    emittedBy: SOURCE_APPS.LIFEGLANCE,
    action:    ACTIONS.CREATE,
    payload: {
      title:            milestone.title,
      due:              milestone.date,
      source_app:       SOURCE_APPS.LIFEGLANCE,
      source_entity_id: milestone.id,
      notes:            milestone.note || undefined,
    },
  })
  await putEventFile(cfg, envelope)
  return envelope.event_id
}

// Emit an outbound `notify` when a linked milestone's date changes.
export async function emitRescheduledNotify(milestone, previousDue) {
  const cfg = loadIntentsConfig()
  if (!cfg.enabled || !cfg.webdavUrl.trim()) return
  if (!milestone.dayglance_linked) return
  const envelope = await buildOutboundEnvelope({
    emittedBy: SOURCE_APPS.LIFEGLANCE,
    action:    ACTIONS.NOTIFY,
    payload: {
      source_app:       SOURCE_APPS.LIFEGLANCE,
      source_entity_id: milestone.id,
      event:            EVENTS.RESCHEDULED,
      task_id:          milestone.dayglance_task_id ?? '',
      title:            milestone.title,
      timestamp:        new Date().toISOString(),
      due:              milestone.date,
      previous_due:     previousDue,
      entity_type:      'goal',
    },
  })
  await putEventFile(cfg, envelope)
  return envelope.event_id
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
