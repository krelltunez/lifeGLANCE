import { describe, it, expect, vi, beforeEach } from 'vitest'

// tombstones.js decides at import whether storage exists, so it is in place first.
vi.hoisted(() => {
  const m = new Map()
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  }
})
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}))

import { ACTIONS, EVENTS, SOURCE_APPS, buildEnvelope, filenameFor } from '@glance-apps/intents'
import { isRelevantInboundEvent, isLastglanceMilestone, localDay, lastglanceMilestoneId, inboundAlreadyHandled } from './useIntentPoller.js'
import { writeMilestoneTombstone } from '../sync/tombstones.js'
import { pollICloudIntents, ICLOUD_EVENTS_PATH } from '../lib/intentsICloudTransport.js'

describe('isRelevantInboundEvent', () => {
  it('accepts a Goal create pushed by dayGLANCE', () => {
    expect(isRelevantInboundEvent({
      action: ACTIONS.CREATE,
      emitted_by: SOURCE_APPS.DAYGLANCE,
      payload: { title: 'Run a marathon', entity_type: 'goal' },
    })).toBe(true)
  })

  it('accepts a notify about a lifeGLANCE-originated task', () => {
    expect(isRelevantInboundEvent({
      action: ACTIONS.NOTIFY,
      emitted_by: SOURCE_APPS.DAYGLANCE,
      payload: { source_app: SOURCE_APPS.LIFEGLANCE, event: EVENTS.COMPLETED },
    })).toBe(true)
  })

  it('ignores lastGLANCE chore traffic in the shared events directory', () => {
    expect(isRelevantInboundEvent({
      action: ACTIONS.CREATE,
      emitted_by: SOURCE_APPS.LASTGLANCE,
      payload: { title: 'Algae Discs', entity_type: 'task' },
    })).toBe(false)
  })

  it('ignores a notify whose task did not originate in lifeGLANCE', () => {
    expect(isRelevantInboundEvent({
      action: ACTIONS.NOTIFY,
      emitted_by: SOURCE_APPS.LASTGLANCE,
      payload: { source_app: SOURCE_APPS.LASTGLANCE, event: EVENTS.COMPLETED },
    })).toBe(false)
  })

  it('ignores a create that did not come from dayGLANCE', () => {
    expect(isRelevantInboundEvent({
      action: ACTIONS.CREATE,
      emitted_by: SOURCE_APPS.LIFEGLANCE,
      payload: { title: 'Self-echo' },
    })).toBe(false)
  })

  it('is safe on empty / malformed input', () => {
    expect(isRelevantInboundEvent()).toBe(false)
    expect(isRelevantInboundEvent({})).toBe(false)
    expect(isRelevantInboundEvent({ action: ACTIONS.NOTIFY })).toBe(false)
  })
})

describe('lastGLANCE People timeline entries', () => {
  const entry = {
    action: ACTIONS.CREATE,
    emitted_by: SOURCE_APPS.LASTGLANCE,
    payload: { title: 'Sam reached out', due: '2026-10-14', entity_type: 'milestone', source_entity_id: 'i1' },
  }

  it('accepts a milestone create from lastGLANCE', () => {
    expect(isRelevantInboundEvent(entry)).toBe(true)
    expect(isLastglanceMilestone(entry)).toBe(true)
  })

  it('still ignores lastGLANCE creates that are not milestones', () => {
    const chore = { ...entry, payload: { title: 'Algae Discs' } }
    expect(isRelevantInboundEvent(chore)).toBe(false)
    expect(isLastglanceMilestone(chore)).toBe(false)
  })

  it('reads a YYYY-MM-DD due as that local day', () => {
    const d = localDay('2026-10-14')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 14])
  })
})

describe('a replayed create does not bring back a deleted milestone', () => {
  beforeEach(() => localStorage.clear())

  it('names a lastGLANCE entry by its interaction id, falling back to the event id', () => {
    expect(lastglanceMilestoneId({ source_entity_id: 'i-1' }, 'e-1')).toBe('lastglance-i-1')
    expect(lastglanceMilestoneId({}, 'e-1')).toBe('e-1')
  })

  it('counts an existing or a deleted milestone as handled', () => {
    expect(inboundAlreadyHandled('a', [{ id: 'a' }], {})).toBe(true)
    expect(inboundAlreadyHandled('b', [{ id: 'a' }], { b: '2026-10-25T00:00:00.000Z' })).toBe(true)
    expect(inboundAlreadyHandled('c', [{ id: 'a' }], {})).toBe(false)
    expect(inboundAlreadyHandled(null, [], {})).toBe(false)
  })

  it('reads the tombstones a deletion writes', () => {
    expect(inboundAlreadyHandled('lastglance-i-1', [])).toBe(false)
    writeMilestoneTombstone('lastglance-i-1')
    expect(inboundAlreadyHandled('lastglance-i-1', [])).toBe(true)
  })

  it("a second device's first iCloud poll replays the folder and re-adds only what was never deleted", async () => {
    // lastGLANCE sent two contact entries; the user deleted one on another device.
    const entry = (interaction, title, at) => buildEnvelope({
      action: ACTIONS.CREATE,
      payload: { title, due: '2026-10-20', source_app: SOURCE_APPS.LASTGLANCE, source_entity_id: interaction, entity_type: 'milestone' },
      emittedBy: SOURCE_APPS.LASTGLANCE,
      emittedAt: new Date(at),
    })
    const files = new Map()
    for (const e of [entry('i-1', 'Sam reached out', '2026-10-20T10:00:00.000Z'), entry('i-2', 'Lunch with Ana', '2026-10-21T10:00:00.000Z')]) {
      files.set(ICLOUD_EVENTS_PATH + filenameFor(e), JSON.stringify(e))
    }
    const bridge = {
      available: async () => true,
      list: async (path) => [...files.keys()].map((p) => p.slice(path.length)),
      read: async (path) => ({ kind: 'text', text: files.get(path) }),
    }
    writeMilestoneTombstone('lastglance-i-1')   // arrived here through sync

    // TimelineView's route: relevance, the stored id, the handled check.
    const milestones = []
    await pollICloudIntents(async (envelope) => {
      if (!isLastglanceMilestone(envelope)) return
      const id = lastglanceMilestoneId(envelope.payload, envelope.event_id)
      if (inboundAlreadyHandled(id, milestones)) return
      milestones.push({ id, title: envelope.payload.title })
    }, { bridge: () => bridge, storage: { getItem: () => null, setItem: () => {} } })

    expect(milestones.map((m) => m.title)).toEqual(['Lunch with Ana'])
  })
})
