// WebDAV deliverer — the file-tier outbox wrapper over the EXISTING WebDAV write.
// Confirms the WebDAV SEND path still works (unchanged behavior) alongside the
// new vault tier, and that it maps outcomes for the outbox correctly.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { deliverToWebdav } from './intentsTransport.js'
import { SOURCE_APPS, ACTIONS } from '@glance-apps/intents'

if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map()
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  }
}

const intent = () => ({
  event_id: '20260101T000000Z-abcdef',
  emitted_by: SOURCE_APPS.LIFEGLANCE,
  action: ACTIONS.CREATE,
  payload: { title: 'Ship it', source_app: SOURCE_APPS.LIFEGLANCE, source_entity_id: 'm1', entity_type: 'goal' },
})

const enableWebdav = () =>
  localStorage.setItem('lifeglance-intents-config', JSON.stringify({ enabled: true, webdavUrl: 'https://dav.example/remote.php', eventsPath: '/GLANCE/events/' }))

let origFetch
beforeEach(() => { origFetch = globalThis.fetch; localStorage.clear() })
afterEach(() => { globalThis.fetch = origFetch })

describe('deliverToWebdav', () => {
  it('writes the event and returns delivered on 2xx', async () => {
    enableWebdav()
    let putBody
    globalThis.fetch = vi.fn(async (url, init) => {
      putBody = init.body
      return { ok: true, status: 201, statusText: 'Created', text: async () => '' }
    })
    const res = await deliverToWebdav(intent())
    expect(res).toBe('delivered')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    // Default file-tier policy is plaintext (encryptionEnabled off) — the envelope
    // carries a readable action (the vault tier would never do this).
    expect(JSON.parse(putBody).action).toBe(ACTIONS.CREATE)
  })

  it('returns transient on a 5xx (held for retry)', async () => {
    enableWebdav()
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, statusText: 'Unavailable', text: async () => '' }))
    expect(await deliverToWebdav(intent())).toBe('transient')
  })

  it('returns permanent on a non-retryable 4xx', async () => {
    enableWebdav()
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 400, statusText: 'Bad Request', text: async () => '' }))
    expect(await deliverToWebdav(intent())).toBe('permanent')
  })

  it('returns transient on a network throw', async () => {
    enableWebdav()
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') })
    expect(await deliverToWebdav(intent())).toBe('transient')
  })

  it('returns permanent when WebDAV is not configured', async () => {
    // No config → the target won't self-heal.
    expect(await deliverToWebdav(intent())).toBe('permanent')
  })
})
