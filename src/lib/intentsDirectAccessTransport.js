// Direct Access as an intents transport (docs/direct-access.md, step 3): the
// sending half (a deliverer for the outbox) and the receiving half (a drain
// for the poller), both over the event-set file (intentsEventSet.js) through
// the Direct Access transport's `events` slot. The gating (enabled, selected,
// folder connected) and the WebDAV salt live in intentsTransport.js and come
// in as deps, so this module imports nothing from there.
//
// Sending: an envelope is sealed, whenever the Direct Access ENCRYPT switch is
// on (the file is encrypted iff the sync file is: one switch, one passphrase),
// under the root key for the salt the event set names; without a key for it
// the intent is held ('transient', retried by the outbox) and never sent as
// plaintext. Receiving: each envelope above the cursor that is not this app's
// goes to the same handler the WebDAV and vault pollers feed; a sealed one
// this device cannot open holds the cursor and reports keyNeeded.

import { buildEnvelope, buildEncryptedEnvelope, deriveEnvelopeKey } from '@glance-apps/intents'
import { getSyncPassphrase } from '@glance-apps/sync'
import { directAccessTransport, directAccessEncryptsWrites } from '../sync/directAccess.js'
import { ensureDeviceId } from '../sync/deviceId.js'
import { runEventSetCycle, receiveEnvelope, publishOwnEvent, withEventsLock } from './intentsEventSet.js'
import { keyForSalt } from './intentsDirectAccessKey.js'

/**
 * A deliverer for the outbox: 'delivered' | 'transient' | 'permanent'.
 *
 * @param {object} deps
 * @param {object} [deps.transport] the Direct Access transport
 * @param {() => boolean} deps.isEnabled the intents opt-in with the folder connected
 * @param {() => boolean} [deps.encrypts] the Direct Access encrypt switch
 * @param {(transport: object) => Promise<{ salt: string, key: CryptoKey | null }>} deps.resolveKey the salt the file names (or this device brings) and the key for it; key null means hold
 * @param {Function} [deps.publish]
 * @param {() => string | null | undefined} [deps.eventsPath]
 */
export function createDirectAccessDeliverer(deps) {
  const transport = deps.transport ?? directAccessTransport
  const encrypts = deps.encrypts ?? directAccessEncryptsWrites
  const publish = deps.publish ?? publishOwnEvent
  return async (intent) => {
    if (!deps.isEnabled()) return 'transient'
    if (!transport.isAvailable()) return 'transient'

    const args = { eventId: intent.event_id, emittedBy: intent.emitted_by, action: intent.action, payload: intent.payload }
    let envelope
    let salt = null
    try {
      if (encrypts()) {
        const r = await deps.resolveKey(transport)
        // No key for the folder's salt and no passphrase in memory: hold, never plaintext.
        if (!r.key) return 'transient'
        salt = r.salt
        const rootKey = r.key
        envelope = await buildEncryptedEnvelope(args, (s) => deriveEnvelopeKey(rootKey, s))
      } else {
        envelope = buildEnvelope(args)
      }
    } catch {
      return 'transient'
    }

    try {
      const ok = await publish(transport, envelope, { eventsPath: deps.eventsPath?.(), salt, deviceId: ensureDeviceId })
      return ok ? 'delivered' : 'transient'
    } catch {
      return 'transient'
    }
  }
}

// The receive cycle's state (the relay bookkeeping) is kept per process, like
// the vault drain keeps its cursor.
let cycleState = { lastWriteAt: 0, pendingWrite: null }
let senderKeyChecked = false

/**
 * Receives what the event set holds for this app, once, under the file lock
 * the deliverer shares. Resolves { received, keyNeeded, error }: keyNeeded
 * when a sealed envelope could not be opened, or (checked once per session)
 * when the encrypt switch is on and this device has no key and no passphrase
 * in memory, so the caller can raise the passphrase prompt.
 *
 * @param {(envelope: object) => Promise<void>} onEnvelope
 * @param {object} deps
 * @param {object} [deps.transport]
 * @param {() => boolean} deps.isEnabled
 * @param {(transport: object) => Promise<{ salt: string, key: CryptoKey | null }>} [deps.resolveKey] the sender-side key check
 * @param {() => string | null | undefined} [deps.eventsPath]
 * @param {() => boolean} [deps.encrypts]
 * @param {(saltB64: string) => Promise<CryptoKey | null>} [deps.loadKeyForSalt]
 * @param {{ warn: Function, error: Function }} [deps.log]
 */
export async function drainDirectAccessIntents(onEnvelope, deps) {
  const transport = deps.transport ?? directAccessTransport
  const log = deps.log ?? console
  if (!deps.isEnabled()) return { received: 0, keyNeeded: false, error: null }
  if (!transport.isAvailable()) return { received: 0, keyNeeded: false, error: null }
  const loadKeyForSalt = deps.loadKeyForSalt ?? ((salt) => keyForSalt(salt))
  const r = await withEventsLock(() => runEventSetCycle({
    transport,
    io: {
      eventsPath: deps.eventsPath?.(),
      deviceId: ensureDeviceId,
      receive: (raw, meta) => receiveEnvelope(raw, { handleEnvelope: onEnvelope, salt: meta.salt, loadKeyForSalt, log }),
      log,
    },
    state: cycleState,
  }))
  cycleState = r.state
  if (r.outcome.kind === 'error') {
    log.warn('[intents/direct-access] unavailable:', r.outcome.error)
    return { received: 0, keyNeeded: false, error: r.outcome.error }
  }
  let keyNeeded = r.outcome.kind === 'merged' && r.outcome.keyNeeded
  const encrypts = deps.encrypts ?? directAccessEncryptsWrites
  if (!senderKeyChecked && deps.resolveKey && encrypts()) {
    senderKeyChecked = true
    try {
      const k = await deps.resolveKey(transport)
      if (!k.key && !getSyncPassphrase()) keyNeeded = true
    } catch { /* the deliverer reports its own hold */ }
  }
  return { received: r.outcome.kind === 'merged' ? r.outcome.received : 0, keyNeeded, error: null }
}

/** Test seam: forget the per-process cycle state and the once-per-session key check. */
export function resetDirectAccessIntentsState() {
  cycleState = { lastWriteAt: 0, pendingWrite: null }
  senderKeyChecked = false
}
