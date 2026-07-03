// Tests for the GLANCEvault credential verify-before-save flow.
//
// Mocks the vault client's getSalt for each outcome and asserts: success
// saves+activates and derives keys against the VAULT-FETCHED salt; each hard
// failure (auth/forbidden/network) blocks save with its distinct kind; the
// salt-not-established state is acceptable (saves, no invented salt); the WebDAV
// config is preserved; and the persisted config is exactly what the engine reads.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// localStorage shim (node test env).
if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map()
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  }
}

import { verifyVaultCredentials, runVaultSetup, disableVault, VAULT_OUTCOME } from './vaultSetup.js'
import { readVaultConfig } from './dbSync.js'

const CONFIG_KEY = 'lifeglance-cloud-sync-config'
const CREDS = { vaultUrl: 'https://vault.example', vaultToken: 'tok-123', accountId: 'house-1' }

// A createVaultClient whose getSalt enacts a given behavior (return value or throw).
const clientReturning = (behave) => () => ({ getSalt: async () => behave() })
const vaultError = (status) => { const e = new Error(`get salt failed: ${status}`); e.status = status; return e }

// Spy deps so runVaultSetup never builds a real engine or derives real keys.
function spyDeps(createVaultClient) {
  return {
    createVaultClient,
    setSyncPassphrase: vi.fn(),
    setupDbRootKey: vi.fn(async () => {}),
    setupVaultIntentsRootKey: vi.fn(async () => {}),
    reinit: vi.fn(),
    startSync: vi.fn(),
  }
}

beforeEach(() => { localStorage.clear() })

describe('verifyVaultCredentials — typed outcomes', () => {
  it('salt returned → success', async () => {
    const r = await verifyVaultCredentials(CREDS, { createVaultClient: clientReturning(() => new Uint8Array(16).fill(1)) })
    expect(r.kind).toBe(VAULT_OUTCOME.SUCCESS)
    expect(r.salt).toBeInstanceOf(Uint8Array)
  })
  it('null salt (404 / fresh account) → uninitialized', async () => {
    const r = await verifyVaultCredentials(CREDS, { createVaultClient: clientReturning(() => null) })
    expect(r.kind).toBe(VAULT_OUTCOME.UNINITIALIZED)
  })
  it('401 → auth', async () => {
    const r = await verifyVaultCredentials(CREDS, { createVaultClient: clientReturning(() => { throw vaultError(401) }) })
    expect(r.kind).toBe(VAULT_OUTCOME.AUTH)
  })
  it('403 → forbidden (wrong account)', async () => {
    const r = await verifyVaultCredentials(CREDS, { createVaultClient: clientReturning(() => { throw vaultError(403) }) })
    expect(r.kind).toBe(VAULT_OUTCOME.FORBIDDEN)
  })
  it('network failure → network', async () => {
    const r = await verifyVaultCredentials(CREDS, { createVaultClient: clientReturning(() => { throw new TypeError('fetch failed') }) })
    expect(r.kind).toBe(VAULT_OUTCOME.NETWORK)
  })
  it('405 (no salt endpoint) → unsupported', async () => {
    const r = await verifyVaultCredentials(CREDS, { createVaultClient: clientReturning(() => { throw vaultError(405) }) })
    expect(r.kind).toBe(VAULT_OUTCOME.UNSUPPORTED)
  })
  it('missing fields → network (cannot probe)', async () => {
    const r = await verifyVaultCredentials({ vaultUrl: '', vaultToken: '', accountId: '' }, { createVaultClient: clientReturning(() => null) })
    expect(r.kind).toBe(VAULT_OUTCOME.NETWORK)
  })
})

describe('runVaultSetup — verify-before-save gate', () => {
  it('SUCCESS: saves config, derives both keys against the vault-fetched salt, activates', async () => {
    const salt = new Uint8Array(16).fill(7)
    const deps = spyDeps(clientReturning(() => salt))
    const r = await runVaultSetup({ ...CREDS, passphrase: 'pw' }, deps)

    expect(r).toEqual({ ok: true, kind: VAULT_OUTCOME.SUCCESS })
    // Config persisted exactly as the engine reads it.
    expect(readVaultConfig()).toEqual(CREDS)
    // Keys derived against the FETCHED salt (not invented), before activation.
    expect(deps.setSyncPassphrase).toHaveBeenCalledWith('pw')
    expect(deps.setupDbRootKey).toHaveBeenCalledWith('pw', salt, { cryptoDBName: 'lifeglance-crypto' })
    expect(deps.setupVaultIntentsRootKey).toHaveBeenCalledWith('pw', salt)
    expect(deps.reinit).toHaveBeenCalledTimes(1)
    expect(deps.startSync).toHaveBeenCalledTimes(1)
  })

  it('UNINITIALIZED: acceptable — saves+activates but invents NO salt (no key derivation)', async () => {
    const deps = spyDeps(clientReturning(() => null))
    const r = await runVaultSetup({ ...CREDS, passphrase: 'pw' }, deps)

    expect(r).toEqual({ ok: true, kind: VAULT_OUTCOME.UNINITIALIZED })
    expect(readVaultConfig()).toEqual(CREDS)            // saved
    expect(deps.setSyncPassphrase).toHaveBeenCalledWith('pw')
    expect(deps.setupDbRootKey).not.toHaveBeenCalled()  // no salt → none invented
    expect(deps.setupVaultIntentsRootKey).not.toHaveBeenCalled()
    expect(deps.reinit).toHaveBeenCalledTimes(1)        // still activated
  })

  for (const [status, kind] of [[401, VAULT_OUTCOME.AUTH], [403, VAULT_OUTCOME.FORBIDDEN]]) {
    it(`${kind}: hard-fail blocks save (no config written, no activation)`, async () => {
      const deps = spyDeps(clientReturning(() => { throw vaultError(status) }))
      const r = await runVaultSetup({ ...CREDS, passphrase: 'pw' }, deps)
      expect(r).toEqual({ ok: false, kind })
      expect(localStorage.getItem(CONFIG_KEY)).toBeNull()  // nothing persisted
      expect(readVaultConfig()).toBeNull()
      expect(deps.reinit).not.toHaveBeenCalled()
      expect(deps.setSyncPassphrase).not.toHaveBeenCalled()
    })
  }

  it('NETWORK: hard-fail blocks save', async () => {
    const deps = spyDeps(clientReturning(() => { throw new TypeError('fetch failed') }))
    const r = await runVaultSetup({ ...CREDS, passphrase: 'pw' }, deps)
    expect(r).toEqual({ ok: false, kind: VAULT_OUTCOME.NETWORK })
    expect(readVaultConfig()).toBeNull()
    expect(deps.reinit).not.toHaveBeenCalled()
  })

  it('missing passphrase: blocks save even when credentials verify', async () => {
    const deps = spyDeps(clientReturning(() => new Uint8Array(16).fill(7)))
    const r = await runVaultSetup({ ...CREDS, passphrase: '' }, deps)
    expect(r).toEqual({ ok: false, kind: 'passphrase' })
    expect(readVaultConfig()).toBeNull()
    expect(deps.reinit).not.toHaveBeenCalled()
  })

  it('preserves the WebDAV config when enabling vault (tiers coexist)', async () => {
    const webdav = { provider: 'nextcloud', url: 'https://nc.example', username: 'me', password: 'pw', folder: 'GLANCE/lifeglance', enabled: true }
    localStorage.setItem(CONFIG_KEY, JSON.stringify(webdav))

    const deps = spyDeps(clientReturning(() => new Uint8Array(16).fill(7)))
    await runVaultSetup({ ...CREDS, passphrase: 'pw' }, deps)

    const written = JSON.parse(localStorage.getItem(CONFIG_KEY))
    // WebDAV fields intact…
    expect(written).toMatchObject(webdav)
    // …and vault fields added alongside.
    expect(written).toMatchObject({ vaultEnabled: true, ...CREDS })
  })
})

describe('disableVault', () => {
  it('clears only vaultEnabled, keeps WebDAV + vault creds, rebuilds engine', async () => {
    const webdav = { provider: 'nextcloud', url: 'https://nc.example', username: 'me', enabled: true }
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...webdav, vaultEnabled: true, ...CREDS }))
    const reinit = vi.fn()
    disableVault({ reinit })
    const written = JSON.parse(localStorage.getItem(CONFIG_KEY))
    expect(written.vaultEnabled).toBe(false)
    expect(written).toMatchObject(webdav)            // WebDAV untouched
    expect(written.accountId).toBe(CREDS.accountId)  // creds kept for easy re-enable
    expect(reinit).toHaveBeenCalledTimes(1)
    expect(readVaultConfig()).toBeNull()             // engine now reads it as disabled
  })
})
