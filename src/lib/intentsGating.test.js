// Intents integration gating — the dayGLANCE integration is its OWN opt-in,
// independent of GLANCEvault sync, with a single either/or transport.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  isWebdavIntentsActive,
  isVaultIntentsActive,
  isIntegrationEnabled,
  computeIntentTargets,
  saveIntentsConfig,
} from './intentsTransport.js'

if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map()
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  }
}

const SYNC_CONFIG_KEY = 'lifeglance-cloud-sync-config'
const setVaultSync = (on) =>
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(
    on ? { vaultEnabled: true, vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' } : {},
  ))

beforeEach(() => localStorage.clear())

describe('transport gating', () => {
  it('everything off by default', () => {
    expect(isWebdavIntentsActive()).toBe(false)
    expect(isVaultIntentsActive()).toBe(false)
    expect(isIntegrationEnabled()).toBe(false)
    expect(computeIntentTargets()).toEqual([])
  })

  it('WebDAV transport: active only when enabled + selected + URL present', () => {
    saveIntentsConfig({ enabled: true, transport: 'webdav', webdavUrl: 'https://dav.example' })
    expect(isWebdavIntentsActive()).toBe(true)
    expect(isVaultIntentsActive()).toBe(false)
    expect(isIntegrationEnabled()).toBe(true)
    expect(computeIntentTargets()).toEqual(['webdav'])
  })

  it('GLANCEvault transport: active only when enabled + selected + vault configured', () => {
    setVaultSync(true)
    saveIntentsConfig({ enabled: true, transport: 'vault' })
    expect(isVaultIntentsActive()).toBe(true)
    expect(isWebdavIntentsActive()).toBe(false)
    expect(isIntegrationEnabled()).toBe(true)
    expect(computeIntentTargets()).toEqual(['vault'])
  })

  it('DECOUPLED: vault sync on but the integration off → nothing active', () => {
    setVaultSync(true)                      // GLANCEvault sync is enabled…
    // …but the dayGLANCE integration was never turned on.
    expect(isVaultIntentsActive()).toBe(false)
    expect(isIntegrationEnabled()).toBe(false)
    expect(computeIntentTargets()).toEqual([])
  })

  it('vault transport selected but vault not configured → not active', () => {
    setVaultSync(false)
    saveIntentsConfig({ enabled: true, transport: 'vault' })
    expect(isVaultIntentsActive()).toBe(false)
    expect(computeIntentTargets()).toEqual([])
  })

  it('either/or: selecting vault does not also target WebDAV even if a URL is set', () => {
    setVaultSync(true)
    saveIntentsConfig({ enabled: true, transport: 'vault', webdavUrl: 'https://dav.example' })
    expect(computeIntentTargets()).toEqual(['vault'])
    expect(isWebdavIntentsActive()).toBe(false)
  })

  it('backward-compat: a legacy config with no transport field defaults to WebDAV', () => {
    saveIntentsConfig({ enabled: true, webdavUrl: 'https://dav.example' }) // no `transport`
    expect(isWebdavIntentsActive()).toBe(true)
    expect(computeIntentTargets()).toEqual(['webdav'])
  })
})
