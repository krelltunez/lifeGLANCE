// Intents integration gating — the dayGLANCE integration is its OWN opt-in,
// independent of GLANCEvault sync, with a single either/or transport.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  isWebdavIntentsActive,
  isVaultIntentsActive,
  isDirectAccessIntentsActive,
  isICloudIntentsActive,
  isIntegrationEnabled,
  computeIntentTargets,
  buildIntentDeliverers,
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
    expect(isDirectAccessIntentsActive()).toBe(false)
    expect(isIntegrationEnabled()).toBe(false)
    expect(computeIntentTargets()).toEqual([])
  })

  it('Direct Access transport: active only when enabled + selected + a folder is connected on a shell with the plugin', () => {
    const folder = (supported, connected) => ({ isSupported: () => supported, isConnected: () => connected })
    saveIntentsConfig({ enabled: true, transport: 'directAccess' })
    expect(isDirectAccessIntentsActive(folder(true, true))).toBe(true)
    expect(isDirectAccessIntentsActive(folder(true, false))).toBe(false)
    expect(isDirectAccessIntentsActive(folder(false, true))).toBe(false)
    // The default transport has no plugin under node: nothing is active, nothing targeted.
    expect(isDirectAccessIntentsActive()).toBe(false)
    expect(isIntegrationEnabled()).toBe(false)
    expect(computeIntentTargets()).toEqual([])
    expect(Object.keys(buildIntentDeliverers())).toEqual([])
    saveIntentsConfig({ enabled: true, transport: 'webdav', webdavUrl: 'https://dav.example' })
    expect(isDirectAccessIntentsActive(folder(true, true))).toBe(false)
    saveIntentsConfig({ enabled: false, transport: 'directAccess' })
    expect(isDirectAccessIntentsActive(folder(true, true))).toBe(false)
  })

  it('iCloud transport: active only when enabled + selected on a shell with the plugin', () => {
    const plugin = () => ({})
    saveIntentsConfig({ enabled: true, transport: 'icloud' })
    expect(isICloudIntentsActive(plugin)).toBe(true)
    expect(isICloudIntentsActive(() => null)).toBe(false)
    // No plugin under node: nothing is active, nothing targeted.
    expect(isICloudIntentsActive()).toBe(false)
    expect(isIntegrationEnabled()).toBe(false)
    expect(computeIntentTargets()).toEqual([])
    expect(Object.keys(buildIntentDeliverers())).toEqual([])
    saveIntentsConfig({ enabled: true, transport: 'webdav', webdavUrl: 'https://dav.example' })
    expect(isICloudIntentsActive(plugin)).toBe(false)
    saveIntentsConfig({ enabled: false, transport: 'icloud' })
    expect(isICloudIntentsActive(plugin)).toBe(false)
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
