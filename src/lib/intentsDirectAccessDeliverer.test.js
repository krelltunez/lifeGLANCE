// The Direct Access deliverer: the outbox wrapper over the event-set file
// (intentsDirectAccessTransport.js). Holds while the opt-in is off or the
// folder is away, publishes with the intent's own id, seals under the key for
// the file's salt when the encrypt switch is on and holds without one.

import { describe, it, expect, vi } from 'vitest'
import { deriveIntentsRootKey, SOURCE_APPS, ACTIONS } from '@glance-apps/intents'
import { createDirectAccessDeliverer } from './intentsDirectAccessTransport.js'

if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map()
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  }
}

const intent = {
  event_id: '20261011T120000Z-abcdef',
  emitted_by: SOURCE_APPS.LIFEGLANCE,
  action: ACTIONS.CREATE,
  payload: { title: 'Ship it', due: '2026-10-11', source_app: SOURCE_APPS.LIFEGLANCE, source_entity_id: 'm1', entity_type: 'goal' },
}
const transport = { id: 'da', isAvailable: () => true, events: { supported: () => true, read: async () => null, write: async () => true } }
const SALT = 'c2FsdA=='

describe('the Direct Access deliverer', () => {
  it('holds while the opt-in is off or the folder is away, never giving up', async () => {
    const publish = vi.fn(async () => true)
    const off = createDirectAccessDeliverer({ transport, isEnabled: () => false, encrypts: () => false, resolveKey: async () => ({ salt: SALT, key: null }), publish })
    expect(await off(intent)).toBe('transient')
    const away = createDirectAccessDeliverer({ transport: { ...transport, isAvailable: () => false }, isEnabled: () => true, encrypts: () => false, resolveKey: async () => ({ salt: SALT, key: null }), publish })
    expect(await away(intent)).toBe('transient')
    expect(publish).not.toHaveBeenCalled()
  })

  it("publishes a plaintext envelope with the intent's own id, and reports delivered once the file holds it", async () => {
    const published = []
    const publish = vi.fn(async (_t, e) => { published.push(e); return true })
    const d = createDirectAccessDeliverer({ transport, isEnabled: () => true, encrypts: () => false, resolveKey: async () => ({ salt: SALT, key: null }), publish })
    expect(await d(intent)).toBe('delivered')
    expect(published[0]).toMatchObject({ event_id: intent.event_id, emitted_by: SOURCE_APPS.LIFEGLANCE, action: ACTIONS.CREATE })
    expect(published[0].encrypted).toBeUndefined()
    publish.mockResolvedValueOnce(false)
    expect(await d(intent)).toBe('transient')
    publish.mockRejectedValueOnce(new Error('boom'))
    expect(await d(intent)).toBe('transient')
  })

  it("with the encrypt switch on it holds without a key for the file's salt, and seals with one", async () => {
    const published = []
    const publish = vi.fn(async (_t, e) => { published.push(e); return true })
    const noKey = createDirectAccessDeliverer({ transport, isEnabled: () => true, encrypts: () => true, resolveKey: async () => ({ salt: SALT, key: null }), publish })
    expect(await noKey(intent)).toBe('transient')
    expect(publish).not.toHaveBeenCalled()
    const root = await deriveIntentsRootKey('pass', new Uint8Array(16).fill(7))
    const sealed = createDirectAccessDeliverer({ transport, isEnabled: () => true, encrypts: () => true, resolveKey: async () => ({ salt: SALT, key: root }), publish })
    expect(await sealed(intent)).toBe('delivered')
    expect(published[0]).toMatchObject({ event_id: intent.event_id, encrypted: true })
    // The salt rides along to the file.
    expect(publish.mock.calls[0][2]).toMatchObject({ salt: SALT })
  })
})
