import { describe, it, expect } from 'vitest'
import { isSyncing } from './status.js'

describe('isSyncing', () => {
  it('is true for the in-flight statuses', () => {
    expect(isSyncing('uploading')).toBe(true)
    expect(isSyncing('downloading')).toBe(true)
  })

  it('is false for terminal statuses', () => {
    expect(isSyncing('success')).toBe(false)
    expect(isSyncing('error')).toBe(false)
    expect(isSyncing('idle')).toBe(false)
  })

  it('is false for unknown / legacy values', () => {
    // The dot historically checked for 'syncing', which the engine never emits.
    expect(isSyncing('syncing')).toBe(false)
    expect(isSyncing(undefined)).toBe(false)
    expect(isSyncing('')).toBe(false)
  })
})
