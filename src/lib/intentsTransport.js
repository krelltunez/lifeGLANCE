// WebDAV transport for the @glance-apps/intents protocol.
// Handles config persistence, event file emission, and polling for inbound events.

import {
  buildEnvelope,
  parseEnvelope,
  filenameFor,
  SOURCE_APPS,
  ACTIONS,
  EVENTS,
} from '@glance-apps/intents'

const CONFIG_KEY = 'lifeglance-intents-config'
const CURSOR_KEY = 'lifeglance-intents-cursor'

export const DEFAULT_CONFIG = {
  enabled:        false,
  webdavUrl:      '',   // https://cloud.example.com/remote.php/dav/files/user
  webdavUser:     '',
  webdavPass:     '',
  eventsPath:     '/GLANCE/events/',
  pollIntervalMin: 2,
}

// Proxy URL from the build env — same Vercel function used by the sync layer.
const PROXY_URL = import.meta.env.VITE_WEBDAV_PROXY_URL ?? ''

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

// Routes a fetch through the shared Vercel proxy (X-WebDAV-Url header) when
// VITE_WEBDAV_PROXY_URL is set, matching api/webdav-proxy.js convention.
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
  const res = await proxyFetch(
    cfg, '', 'PROPFIND',
    { 'Depth': '1', 'Content-Type': 'application/xml' },
    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
  )
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
    err.transient = true  // network-level failure (TypeError / AbortError)
    throw err
  }
  if (!res.ok) {
    const err = new Error(`GET ${filename} failed: ${res.status}`)
    err.transient = res.status >= 500
    throw err
  }
  return res.json()
}

// ── Emit helpers ──────────────────────────────────────────────────────────────

// Emit an outbound `create` to dayGLANCE for a milestone the user wants tracked.
export async function emitCreateForMilestone(milestone) {
  const cfg = loadIntentsConfig()
  if (!cfg.enabled || !cfg.webdavUrl.trim()) return
  const envelope = buildEnvelope({
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
  const envelope = buildEnvelope({
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

  const cursor = loadCursor()
  let files
  try {
    files = await listEventFiles(cfg)
  } catch (err) {
    if (err.transient) return
    console.warn('[intents] PROPFIND failed (non-transient):', err)
    return
  }

  const toProcess = cursor
    ? files.filter(f => f.replace('.json', '') > cursor.replace('.json', ''))
    : files

  let lastProcessed = cursor
  for (const filename of toProcess) {
    let envelope
    try {
      const raw = await getEventFile(cfg, filename)
      envelope  = parseEnvelope(raw)
    } catch (err) {
      if (err.transient) break
      console.warn('[intents] skipping malformed event file:', filename, err)
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
