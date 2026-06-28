// GLANCEvault credential verification + activation (settings UI logic).
//
// Split out of CloudSyncModal so the verify-before-save flow is unit-testable
// without rendering React. The UI (CloudSyncModal) is a thin shell over these.
//
// Verify-before-save is the piece lastGLANCE lacked: before persisting and
// activating vault sync we make an AUTHENTICATED getSalt(accountId) probe with
// the entered URL + token + account, using the SAME createVaultClient the engine
// (and the blob/intents transport) use. Distinct typed outcomes tell the user
// which thing is wrong. The only non-failure-but-special case is a fresh account
// whose salt isn't established yet: that's acceptable (the engine establishes the
// salt on first sync — we never invent one).
//
// Passphrase/key foundation (shared with blobs + intents): the vault uses the
// SINGLE sync passphrase, not a vault-specific secret. When the salt already
// exists we derive BOTH the DB-sync root key (setupDbRootKey) and the intents/
// blob root key (setupIntentsEncryption) from passphrase + the VAULT-FETCHED salt
// BEFORE activating, so the key is cached when the engine comes up and lifeGLANCE
// stays byte-identical-decryptable with the other apps. We never derive against
// an invented salt.

import {
  createVaultClient as defaultCreateVaultClient,
  setSyncPassphrase as defaultSetSyncPassphrase,
  setupDbRootKey as defaultSetupDbRootKey,
} from '@glance-apps/sync'
import { setupIntentsEncryption as defaultSetupIntentsEncryption } from '../lib/intentsKeyStore.js'
import { reinitDbSyncEngine as defaultReinit, getDbSyncEngine } from './dbSync.js'

const CONFIG_KEY    = 'lifeglance-cloud-sync-config'
const CRYPTO_DBNAME = 'lifeglance-crypto'

// Outcome kinds. 'success' and 'uninitialized' permit save/activate; the rest
// hard-fail and block it. Each maps to a distinct, translatable message in the UI.
export const VAULT_OUTCOME = {
  SUCCESS:       'success',        // salt returned — credentials good
  UNINITIALIZED: 'uninitialized',  // reachable + authorised, but no salt yet (fresh account) — acceptable
  AUTH:          'auth',           // 401 — wrong device token
  FORBIDDEN:     'forbidden',      // 403 — account not found / not permitted for this token
  NETWORK:       'network',        // unreachable / bad URL / 5xx
  UNSUPPORTED:   'unsupported',    // server too old (no salt endpoint)
}

/**
 * Authenticated getSalt probe. Returns a typed outcome; never throws.
 * @returns {Promise<{kind: string, salt?: Uint8Array}>}
 */
export async function verifyVaultCredentials({ vaultUrl, vaultToken, accountId }, deps = {}) {
  const createClient = deps.createVaultClient ?? defaultCreateVaultClient
  if (!vaultUrl?.trim() || !vaultToken?.trim() || !accountId?.trim()) {
    return { kind: VAULT_OUTCOME.NETWORK }
  }
  let client
  try {
    client = createClient({ vaultUrl: vaultUrl.trim(), vaultToken: vaultToken.trim() })
  } catch {
    return { kind: VAULT_OUTCOME.NETWORK } // malformed URL / missing fetch
  }
  try {
    const salt = await client.getSalt(accountId.trim())
    // getSalt resolves null on 404 (or an empty body): reachable + authorised,
    // but the account has no salt yet — a fresh, not-yet-initialised household.
    if (salt && salt.length) return { kind: VAULT_OUTCOME.SUCCESS, salt }
    return { kind: VAULT_OUTCOME.UNINITIALIZED }
  } catch (err) {
    const status = err?.status
    if (status === 401) return { kind: VAULT_OUTCOME.AUTH }
    if (status === 403) return { kind: VAULT_OUTCOME.FORBIDDEN }
    if (status === 405 || status === 501) return { kind: VAULT_OUTCOME.UNSUPPORTED }
    return { kind: VAULT_OUTCOME.NETWORK } // network failure / 5xx / unknown
  }
}

// Merge the vault fields into the SHARED cloud-sync config object, preserving any
// existing WebDAV fields untouched (the two tiers coexist on one config object —
// the same key the file-tier engine and readVaultConfig both use).
function persistVaultConfig({ vaultUrl, vaultToken, accountId }) {
  let cfg = {}
  try { cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {} } catch { cfg = {} }
  const next = {
    ...cfg,
    vaultEnabled: true,
    vaultUrl:   vaultUrl.trim(),
    vaultToken: vaultToken.trim(),
    accountId:  accountId.trim(),
  }
  localStorage.setItem(CONFIG_KEY, JSON.stringify(next))
  return next
}

/**
 * Verify, then (only if verification permits) persist + derive keys + activate.
 * Verification runs INSIDE here too, so the UI cannot bypass it.
 *
 * @returns {Promise<{ok: boolean, kind: string}>}
 *   ok:false with the failing kind when verification hard-fails or the passphrase
 *   is missing; ok:true with the (acceptable) kind on save+activate.
 */
export async function runVaultSetup({ vaultUrl, vaultToken, accountId, passphrase }, deps = {}) {
  const outcome = await verifyVaultCredentials({ vaultUrl, vaultToken, accountId }, deps)
  if (outcome.kind !== VAULT_OUTCOME.SUCCESS && outcome.kind !== VAULT_OUTCOME.UNINITIALIZED) {
    return { ok: false, kind: outcome.kind }
  }
  if (!passphrase) return { ok: false, kind: 'passphrase' }

  // Persist the exact shape the engine reads (WebDAV fields preserved).
  ;(deps.persist ?? persistVaultConfig)({ vaultUrl, vaultToken, accountId })

  // Single sync passphrase in session, then derive-before-activate when we have a
  // real salt. On a fresh (uninitialized) account we do NOT invent a salt: the
  // passphrase is set so the engine derives + establishes the salt on first sync.
  ;(deps.setSyncPassphrase ?? defaultSetSyncPassphrase)(passphrase)
  if (outcome.kind === VAULT_OUTCOME.SUCCESS) {
    await (deps.setupDbRootKey ?? defaultSetupDbRootKey)(passphrase, outcome.salt, { cryptoDBName: CRYPTO_DBNAME })
    await (deps.setupIntentsEncryption ?? defaultSetupIntentsEncryption)(passphrase, outcome.salt)
  }

  // Activate IN PLACE (rebuild the engine from the freshly saved config) and kick
  // a first sync, which seeds the HWM=0 full snapshot.
  await (deps.reinit ?? defaultReinit)()
  await (deps.startSync ?? (() => getDbSyncEngine()?.sync()))()
  return { ok: true, kind: outcome.kind }
}

// Turn vault sync off without touching the WebDAV tier: clear only vaultEnabled
// (credentials are kept so re-enabling is one toggle), then rebuild the engine
// (which reads vaultEnabled=false and goes inert).
export function disableVault(deps = {}) {
  let cfg = {}
  try { cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {} } catch { cfg = {} }
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...cfg, vaultEnabled: false }))
  ;(deps.reinit ?? defaultReinit)()
}
