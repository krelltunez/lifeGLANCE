// Emit wiring — every lifeGLANCE emit routes through the durable outbox.
//
// Asserts the SEND-side emit contract with the outbox + vault transport mocked:
//   • an emit enqueues a RAW intent (not an envelope) with a stable event_id and
//     the correct enabled targets;
//   • the change-marker (the caller's post-emit ".then") advances only AFTER a
//     durable enqueue — a failed enqueue rejects and the marker never runs.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EVENTS, SOURCE_APPS, ACTIONS } from '@glance-apps/intents'

const h = vi.hoisted(() => ({
  enqueue: vi.fn(async () => ({})),
  flush: vi.fn(async () => ({})),
  vaultConn: { value: { vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' } },
}))

vi.mock('./intentsOutbox.js', () => ({ enqueue: h.enqueue, flush: h.flush, MAX_OUTBOX_ATTEMPTS: 50 }))
vi.mock('./intentsVaultTransport.js', () => ({
  readVaultIntentsConnection: () => h.vaultConn.value,
  makeVaultDeliverer: () => (async () => 'delivered'),
}))

// localStorage shim (the gating helpers read the intents config).
if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map()
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  }
}

const { emitCreateForMilestone, emitStateNotify, emitRescheduledNotify, computeIntentTargets } =
  await import('./intentsTransport.js')

// The integration is its own opt-in; a single transport is selected (either/or).
const enableWebdav = () =>
  localStorage.setItem('lifeglance-intents-config', JSON.stringify({ enabled: true, transport: 'webdav', webdavUrl: 'https://dav.example/remote.php' }))
const enableVault = () =>
  localStorage.setItem('lifeglance-intents-config', JSON.stringify({ enabled: true, transport: 'vault' }))

const milestone = (over = {}) => ({ id: 'm1', title: 'Ship it', date: '2026-02-01', note: '', dayglance_linked: true, ...over })

beforeEach(() => {
  h.enqueue.mockClear()
  h.flush.mockClear()
  h.enqueue.mockResolvedValue({})
  h.vaultConn.value = { vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }
  localStorage.clear()
})

describe('emit → outbox', () => {
  it('enqueues a RAW create intent with a stable event_id and the selected (WebDAV) target', async () => {
    enableWebdav()
    const id = await emitCreateForMilestone(milestone())
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    const [intent, targets] = h.enqueue.mock.calls[0]
    expect(targets).toEqual(['webdav'])            // single selected transport
    expect(intent.action).toBe(ACTIONS.CREATE)
    expect(intent.emitted_by).toBe(SOURCE_APPS.LIFEGLANCE)
    expect(typeof intent.event_id).toBe('string')
    expect(intent.event_id).toBe(id)                 // returned id === enqueued id (stable)
    expect(intent.payload.title).toBe('Ship it')
    expect(intent.payload.source_entity_id).toBe('m1')
    expect(intent.payload.entity_type).toBe('goal')
    // RAW intent, never an envelope.
    expect(intent.encrypted).toBeUndefined()
    expect(intent.salt).toBeUndefined()
  })

  it('enqueues a notify carrying event_id inside the payload', async () => {
    enableWebdav()
    await emitStateNotify(milestone(), EVENTS.UPDATED)
    const [intent] = h.enqueue.mock.calls[0]
    expect(intent.action).toBe(ACTIONS.NOTIFY)
    expect(intent.payload.event).toBe(EVENTS.UPDATED)
    expect(intent.payload.event_id).toBe(intent.event_id)
  })

  it('routes rescheduled notify with previous_due', async () => {
    enableWebdav()
    await emitRescheduledNotify(milestone(), '2026-01-01')
    const [intent] = h.enqueue.mock.calls[0]
    expect(intent.payload.event).toBe(EVENTS.RESCHEDULED)
    expect(intent.payload.previous_due).toBe('2026-01-01')
  })

  it('targets the vault when GLANCEvault is the selected transport', async () => {
    enableVault() // transport: 'vault', vault connection present (default in beforeEach)
    await emitCreateForMilestone(milestone())
    expect(h.enqueue.mock.calls[0][1]).toEqual(['vault'])
    expect(computeIntentTargets()).toEqual(['vault'])
  })

  it('does nothing when the integration is off (independent of vault sync)', async () => {
    // Vault connection is present, but the dayGLANCE integration was never enabled.
    const id = await emitCreateForMilestone(milestone())
    expect(id).toBeNull()
    expect(h.enqueue).not.toHaveBeenCalled()
    expect(computeIntentTargets()).toEqual([])
  })

  it('does nothing when the vault transport is selected but not configured', async () => {
    enableVault()
    h.vaultConn.value = null // GLANCEvault not set up in Cloud Sync
    const id = await emitCreateForMilestone(milestone())
    expect(id).toBeNull()
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('skips notify for an unlinked milestone', async () => {
    enableWebdav()
    const id = await emitStateNotify(milestone({ dayglance_linked: false }), EVENTS.DELETED)
    expect(id).toBeNull()
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('does NOT advance the change-marker on a failed enqueue', async () => {
    enableWebdav()
    h.enqueue.mockRejectedValueOnce(new Error('idb write failed'))
    const marker = vi.fn()
    await emitCreateForMilestone(milestone()).then(marker).catch(() => {})
    expect(marker).not.toHaveBeenCalled()            // durable enqueue failed → marker held
    expect(h.flush).not.toHaveBeenCalled()           // and no flush was triggered
  })

  it('advances the change-marker only AFTER a durable enqueue', async () => {
    enableWebdav()
    const marker = vi.fn()
    await emitCreateForMilestone(milestone()).then(marker)
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    expect(marker).toHaveBeenCalledTimes(1)
  })
})
