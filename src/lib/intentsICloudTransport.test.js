import { describe, it, expect, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}))

import { buildEnvelope, filenameFor, ACTIONS, EVENTS, SOURCE_APPS, eventId } from '@glance-apps/intents'
import { createICloudDeliverer, pollICloudIntents, ICLOUD_EVENTS_PATH, ICLOUD_INTENTS_CURSOR_KEY } from './intentsICloudTransport.js'

const memStorage = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: (k) => { m.delete(k) }, m }
}

/** dayGLANCE's iCloud container as the events folder sees it. */
function folder() {
  const files = new Map()
  const downloading = new Set()
  let available = true
  let dirMade = false
  const calls = []
  const bridge = {
    available: async () => available,
    read: async (path, { container } = {}) => {
      calls.push({ op: 'read', container })
      if (downloading.has(path)) return { kind: 'downloading' }
      return files.has(path) ? { kind: 'text', text: files.get(path) } : { kind: 'absent' }
    },
    write: async (path, text, { container } = {}) => {
      calls.push({ op: 'write', container })
      if (!dirMade) return false
      files.set(path, text); return true
    },
    list: async (path, container) => {
      calls.push({ op: 'list', container })
      if (!available) return null
      return [...files.keys()].filter((p) => p.startsWith(path)).map((p) => p.slice(path.length))
    },
    remove: async (path) => files.delete(path),
    makeDir: async (_p, container) => { calls.push({ op: 'makeDir', container }); dirMade = true; return true },
    onChanged: () => () => {},
  }
  return { files, bridge, calls, downloading, setAvailable: (v) => { available = v }, mkdir: () => { dirMade = true } }
}

const intent = (title) => ({
  event_id: eventId(new Date('2026-10-25T12:00:00.000Z')),
  action: ACTIONS.CREATE,
  emitted_by: SOURCE_APPS.LIFEGLANCE,
  payload: { title, due: '2026-10-25', source_app: SOURCE_APPS.LIFEGLANCE, source_entity_id: 'm1', entity_type: 'goal' },
})

/** dayGLANCE telling lifeGLANCE a goal it sent was completed. */
const notifyFromDayglance = (at, entity) => buildEnvelope({
  action: ACTIONS.NOTIFY,
  payload: {
    event_id: '00000000-0000-4000-8000-000000000001', source_app: SOURCE_APPS.LIFEGLANCE, source_entity_id: entity,
    event: EVENTS.COMPLETED, task_id: 't-' + entity, title: entity, timestamp: at, completed_at: at,
  },
  emittedBy: SOURCE_APPS.DAYGLANCE,
  emittedAt: new Date(at),
})

const put = (f, e, name) => { f.files.set(ICLOUD_EVENTS_PATH + (name ?? filenameFor(e)), JSON.stringify(e)) }
const entity = (e) => e.payload.source_entity_id

describe('the iCloud intents deliverer', () => {
  it("writes a plaintext envelope into dayGLANCE's events folder, creating it on the first send", async () => {
    const f = folder()
    const deliver = createICloudDeliverer({ bridge: () => f.bridge, isEnabled: () => true })
    const i = intent('Run a marathon')
    expect(await deliver(i)).toBe('delivered')
    const [path, text] = [...f.files.entries()][0]
    const envelope = JSON.parse(text)
    expect(path).toBe(ICLOUD_EVENTS_PATH + filenameFor(envelope))
    expect(path.startsWith('GLANCE/events/')).toBe(true)
    expect(envelope.encrypted).toBeUndefined()                 // never sealed on iCloud
    expect(envelope.event_id).toBe(i.event_id)                 // the outbox's id: re-delivery is idempotent
    expect(envelope.payload.title).toBe('Run a marathon')
    expect(f.calls.every((c) => c.container === 'dayglance')).toBe(true)
    expect(f.calls.map((c) => c.op)).toEqual(['write', 'makeDir', 'write'])
  })

  it('carries a notify as a notify', async () => {
    const f = folder(); f.mkdir()
    const deliver = createICloudDeliverer({ bridge: () => f.bridge, isEnabled: () => true })
    const n = { ...intent('x'), action: ACTIONS.NOTIFY, payload: { event_id: 'e', source_app: SOURCE_APPS.LIFEGLANCE, source_entity_id: 'm1', event: EVENTS.COMPLETED, task_id: 'm1', title: 'x', timestamp: '2026-10-25T12:00:00.000Z' } }
    expect(await deliver(n)).toBe('delivered')
    expect(JSON.parse([...f.files.values()][0]).action).toBe(ACTIONS.NOTIFY)
  })

  it('holds while off or while iCloud is away, and never gives up', async () => {
    const f = folder(); f.mkdir()
    let on = false
    const deliver = createICloudDeliverer({ bridge: () => f.bridge, isEnabled: () => on })
    expect(await deliver(intent('a'))).toBe('transient')
    on = true
    f.setAvailable(false)
    expect(await deliver(intent('b'))).toBe('transient')
    expect(await createICloudDeliverer({ bridge: () => null, isEnabled: () => true })(intent('c'))).toBe('transient')
    expect(f.files.size).toBe(0)
  })
})

describe('the iCloud intents poll', () => {
  it("hands dayGLANCE's events over in order from its container and moves the cursor", async () => {
    const f = folder()
    const storage = memStorage()
    const a = notifyFromDayglance('2026-10-25T10:00:00.000Z', 'goal-a')
    const b = notifyFromDayglance('2026-10-25T11:00:00.000Z', 'goal-b')
    put(f, b); put(f, a)
    const seen = []
    await pollICloudIntents(async (e) => { seen.push(entity(e)) }, { bridge: () => f.bridge, storage })
    expect(seen).toEqual(['goal-a', 'goal-b'])
    expect(storage.getItem(ICLOUD_INTENTS_CURSOR_KEY)).toBe(filenameFor(b))
    expect(f.calls.every((c) => c.container === 'dayglance')).toBe(true)
  })

  it('hands an event over once: a second poll with nothing new does nothing', async () => {
    const f = folder()
    const storage = memStorage()
    put(f, notifyFromDayglance('2026-10-25T10:00:00.000Z', 'goal-a'))
    const seen = []
    const onEvent = async (e) => { seen.push(entity(e)) }
    await pollICloudIntents(onEvent, { bridge: () => f.bridge, storage })
    await pollICloudIntents(onEvent, { bridge: () => f.bridge, storage })
    expect(seen).toEqual(['goal-a'])
    put(f, notifyFromDayglance('2026-10-25T10:05:00.000Z', 'goal-b'))
    await pollICloudIntents(onEvent, { bridge: () => f.bridge, storage })
    expect(seen).toEqual(['goal-a', 'goal-b'])
  })

  it('a file still downloading stops the pass with the cursor in place, and is read on the next poll', async () => {
    const f = folder()
    const storage = memStorage()
    const a = notifyFromDayglance('2026-10-25T10:00:00.000Z', 'goal-a')
    const b = notifyFromDayglance('2026-10-25T11:00:00.000Z', 'goal-b')
    put(f, a); put(f, b)
    f.downloading.add(ICLOUD_EVENTS_PATH + filenameFor(a))
    const seen = []
    const onEvent = async (e) => { seen.push(entity(e)) }
    await pollICloudIntents(onEvent, { bridge: () => f.bridge, storage })
    expect(seen).toEqual([])
    expect(storage.getItem(ICLOUD_INTENTS_CURSOR_KEY)).toBeNull()
    f.downloading.clear()
    await pollICloudIntents(onEvent, { bridge: () => f.bridge, storage })
    expect(seen).toEqual(['goal-a', 'goal-b'])
  })

  it('skips an encrypted envelope as a misconfigured sender, malformed files and the salt file, without stalling', async () => {
    const f = folder()
    const storage = memStorage()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    put(f, { encrypted: true, v: 1 }, '20261025T090000Z-aaaaaa.json')
    f.files.set(ICLOUD_EVENTS_PATH + '20261025T093000Z-bbbbbb.json', 'not json')
    f.files.set(ICLOUD_EVENTS_PATH + 'intents-encryption-salt.json', '{"salt":"x"}')
    const ok = notifyFromDayglance('2026-10-25T11:00:00.000Z', 'goal-b')
    put(f, ok)
    const seen = []
    await pollICloudIntents(async (e) => { seen.push(entity(e)) }, { bridge: () => f.bridge, storage })
    expect(seen).toEqual(['goal-b'])
    expect(warn.mock.calls.some((c) => String(c[0]).includes('encrypted'))).toBe(true)
    expect(storage.getItem(ICLOUD_INTENTS_CURSOR_KEY)).toBe(filenameFor(ok))
    warn.mockRestore()
  })

  it('a handler that throws does not stall the folder', async () => {
    const f = folder()
    const storage = memStorage()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    put(f, notifyFromDayglance('2026-10-25T10:00:00.000Z', 'goal-a'))
    put(f, notifyFromDayglance('2026-10-25T11:00:00.000Z', 'goal-b'))
    const seen = []
    await pollICloudIntents(async (e) => { seen.push(entity(e)); if (entity(e) === 'goal-a') throw new Error('boom') }, { bridge: () => f.bridge, storage })
    expect(seen).toEqual(['goal-a', 'goal-b'])
    vi.restoreAllMocks()
  })

  it('does nothing while iCloud is away or without the plugin', async () => {
    const f = folder()
    put(f, notifyFromDayglance('2026-10-25T10:00:00.000Z', 'goal-a'))
    f.setAvailable(false)
    const onEvent = vi.fn(async () => {})
    await pollICloudIntents(onEvent, { bridge: () => f.bridge, storage: memStorage() })
    await pollICloudIntents(onEvent, { bridge: () => null, storage: memStorage() })
    expect(onEvent).not.toHaveBeenCalled()
  })
})
