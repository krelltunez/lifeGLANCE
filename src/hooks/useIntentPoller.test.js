import { describe, it, expect } from 'vitest'
import { ACTIONS, EVENTS, SOURCE_APPS } from '@glance-apps/intents'
import { isRelevantInboundEvent } from './useIntentPoller.js'

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
