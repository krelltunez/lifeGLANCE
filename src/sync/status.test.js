import { describe, it, expect } from 'vitest'
import { isSyncing, SYNC_ERROR_I18N_KEYS, syncErrorText } from './status.js'

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

describe('syncErrorText', () => {
  // A stand-in for i18next's t(): echoes the key back so we can assert which
  // friendly key was chosen without loading the full i18n resources.
  const t = (key) => `t:${key}`

  it('returns null when there is no error', () => {
    expect(syncErrorText(null, t)).toBe(null)
    expect(syncErrorText(undefined, t)).toBe(null)
  })

  it('maps KEY_MISMATCH to the wrong-passphrase message', () => {
    expect(syncErrorText({ message: 'OperationError', code: 'KEY_MISMATCH' }, t))
      .toBe('t:wrongPassphrase')
  })

  it('maps VERIFIER_UNSUPPORTED to the server-update message', () => {
    expect(syncErrorText({ message: '412 Precondition Failed', code: 'VERIFIER_UNSUPPORTED' }, t))
      .toBe('t:verifierUnsupported')
  })

  it('falls back to the raw engine message for unmapped codes', () => {
    expect(syncErrorText({ message: 'Network down', code: 'NETWORK_ERROR' }, t))
      .toBe('Network down')
    expect(syncErrorText({ message: 'Just a message', code: null }, t))
      .toBe('Just a message')
  })

  it('does not map ACCOUNT_ID_REQUIRED — it is suppressed upstream, not surfaced', () => {
    // The engine's onError swallows this retryable startup race, so it should
    // never reach the display layer. If it ever did, it falls back to raw text
    // rather than being treated as a known, scary error.
    expect(SYNC_ERROR_I18N_KEYS.ACCOUNT_ID_REQUIRED).toBeUndefined()
  })
})
