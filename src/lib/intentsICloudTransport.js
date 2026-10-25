// GLANCEintents over iCloud (docs/icloud-sync.md), dayGLANCE's iCloud intents
// tier, so lifeGLANCE exchanges intents with dayGLANCE and lastGLANCE on an
// iPhone or iPad with nothing but iCloud.
//
//   • The folder is dayGLANCE's: GLANCE/events/ in the iCloud.com.dayglance
//     container, one file per event named by the package's filenameFor, the
//     layout the WebDAV tier uses. Every GLANCE app's App ID carries that
//     container.
//   • Selected like every other intents transport (one of), and only while the
//     integration is enabled: without that nothing is sent to or read from
//     iCloud, which keeps the "intents are opt-in" privacy statement true.
//   • Always plaintext. iCloud Drive is encrypted by Apple at rest and in
//     transit, and dayGLANCE's iCloud poll refuses an encrypted envelope as a
//     misconfigured sender, so this one does too.
//
// The gating lives in intentsTransport.js and comes in as deps, so this module
// imports nothing from there.

import { buildEnvelope, parseEnvelope, parseFilename, filenameFor } from '@glance-apps/intents'
import { icloudBridge } from '../native/icloud.js'

/** dayGLANCE's DEFAULT_EVENTS_PATH, relative to the container's Documents/. */
export const ICLOUD_EVENTS_PATH = 'GLANCE/events/'
export const ICLOUD_INTENTS_CURSOR_KEY = 'lifeglance-icloud-intents-cursor'

const defaultStorage = () => (typeof localStorage === 'undefined' ? null : localStorage)

/**
 * A deliverer for the outbox: 'delivered' | 'transient'. Never 'permanent':
 * iCloud being off, signed out or full all heal, so the intent is held.
 *
 * @param {object} deps
 * @param {() => object | null} [deps.bridge]
 * @param {() => boolean} deps.isEnabled the intents opt-in with iCloud selected
 */
export function createICloudDeliverer(deps) {
  const bridge = deps.bridge ?? icloudBridge
  return async (intent) => {
    const b = bridge()
    if (!b || !deps.isEnabled() || !(await b.available())) return 'transient'
    let envelope
    try {
      envelope = buildEnvelope({ eventId: intent.event_id, emittedBy: intent.emitted_by, action: intent.action, payload: intent.payload })
    } catch {
      return 'transient'
    }
    // The package's name, which dayGLANCE's iCloud deliverer and poll use too.
    const path = ICLOUD_EVENTS_PATH + filenameFor(envelope)
    const body = JSON.stringify(envelope)
    let ok = await b.write(path, body, { container: 'dayglance' })
    if (!ok) {
      // The folder may not exist yet on a first send.
      await b.makeDir(ICLOUD_EVENTS_PATH, 'dayglance')
      ok = await b.write(path, body, { container: 'dayglance' })
    }
    return ok ? 'delivered' : 'transient'
  }
}

/**
 * One poll of the shared events folder: every event file whose name sorts after
 * this transport's cursor, in order (the WebDAV poll's strict filename cursor,
 * so an event is handed over once). A file still downloading stops the pass
 * with the cursor in place, so it is read on a later poll; an unreadable,
 * encrypted or malformed one is noted and passed over.
 *
 * @param {(envelope: object) => Promise<void>} onEvent
 * @param {object} [deps]
 * @param {() => object | null} [deps.bridge]
 * @param {object | null} [deps.storage]
 */
export async function pollICloudIntents(onEvent, deps = {}) {
  const b = (deps.bridge ?? icloudBridge)()
  if (!b) return
  const storage = deps.storage ?? defaultStorage()
  const names = await b.list(ICLOUD_EVENTS_PATH, 'dayglance')
  if (!names) return   // iCloud away: try again next poll

  const cursor = (() => { try { return storage?.getItem(ICLOUD_INTENTS_CURSOR_KEY) ?? '' } catch { return '' } })()
  const stem = (f) => f.replace('.json', '')
  const files = names
    .filter((f) => parseFilename(f) !== null && (!cursor || stem(f) > stem(cursor)))
    .sort()

  let last = cursor
  for (const filename of files) {
    const r = await b.read(ICLOUD_EVENTS_PATH + filename, { container: 'dayglance' })
    if (r.kind === 'downloading') break
    last = filename
    if (r.kind !== 'text') {
      if (r.kind === 'error') console.warn('[intents] iCloud event unreadable:', filename, r.error)
      continue
    }
    let data
    try { data = JSON.parse(r.text ?? '') } catch { console.warn('[intents] skipping malformed iCloud event:', filename); continue }
    if (data && typeof data === 'object' && data.encrypted === true) {
      console.warn('[intents] skipping encrypted iCloud event (iCloud intents are always plain):', filename)
      continue
    }
    let envelope
    try { envelope = parseEnvelope(data) } catch { console.warn('[intents] skipping malformed iCloud event:', filename); continue }
    try {
      await onEvent(envelope)
    } catch (err) {
      console.warn('[intents] handler error for:', filename, err)
    }
  }
  if (last && last !== cursor) {
    try { storage?.setItem(ICLOUD_INTENTS_CURSOR_KEY, last) } catch { /* the next poll re-reads from the old cursor */ }
  }
}
