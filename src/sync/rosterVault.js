// The household roster on GLANCEvault: the glance-users app every GLANCE app
// shares (dayGLANCE, lastGLANCE, lifeGLANCE). lifeGLANCE has no household
// members of its own yet, so for now it only KEEPS the roster: it pulls every
// member into 'lifeglance-users' and never writes, so it cannot clobber an edit
// made in a sibling app. A future member UI reads getHouseholdRoster().
//
// The wire contract, shared with the sibling apps:
//   app       glance-users
//   entityId  the member's sync id
//   entity    { id: sync id, name, updatedAt: ISO string }
//   delete    the engine's soft-delete
// Entities are encrypted under the account's root key, which every app on the
// account already shares (the salt is per account).
//
// A vault server that predates glance-users answers 400 "unknown app": the
// engine stands down for the session.

import { createDbSyncEngine } from '@glance-apps/sync'
import { DB_CRYPTO_CONFIG } from './cryptoConfig.js'
import { ensureDeviceId } from './deviceId.js'
import { nativeVaultFetchImpl } from './nativeVaultFetch.js'

export const ROSTER_VAULT_APP = 'glance-users'
export const ROSTER_KEY = 'lifeglance-users'
// Per-app local state (cursor, dirty set); the vault app is shared.
const STORAGE_PREFIX = `lifeglance-${ROSTER_VAULT_APP}`

export function isRosterEntity(entity) {
  return !!entity && typeof entity === 'object'
    && typeof entity.id === 'string' && !!entity.id
    && typeof entity.name === 'string' && !!entity.name.trim()
    && typeof entity.updatedAt === 'string'
}

function readRoster(storage) {
  try {
    const v = JSON.parse(storage.getItem(ROSTER_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}
const writeRoster = (storage, roster) => storage.setItem(ROSTER_KEY, JSON.stringify(roster))

/** The household members (deleted ones left out), sorted by name. */
export function getHouseholdRoster(storage = localStorage) {
  return readRoster(storage).filter((u) => !u.deleted).sort((a, b) => a.name.localeCompare(b.name))
}

export function getLocalRosterEntity(storage, entityId) {
  const u = readRoster(storage).find((x) => x.id === entityId)
  return u && !u.deleted ? { id: u.id, name: u.name, updatedAt: u.updatedAt } : null
}

/** Upsert a member, last-writer-wins on updatedAt. Returns true when the roster changed. */
export function applyRosterEntity(storage, entityId, entity) {
  if (!isRosterEntity(entity) || entity.id !== entityId) return false
  const roster = readRoster(storage)
  const i = roster.findIndex((u) => u.id === entityId)
  if (i >= 0 && roster[i].updatedAt >= entity.updatedAt) return false
  const next = { id: entity.id, name: entity.name, updatedAt: entity.updatedAt }
  if (i >= 0) roster[i] = next; else roster.push(next)
  writeRoster(storage, roster)
  return true
}

/** Tombstone a member deleted in another app. Returns true when the roster changed. */
export function applyRosterDelete(storage, entityId, now = () => new Date().toISOString()) {
  const roster = readRoster(storage)
  const i = roster.findIndex((u) => u.id === entityId)
  if (i < 0 || roster[i].deleted) return false
  roster[i] = { ...roster[i], deleted: true, updatedAt: now() }
  writeRoster(storage, roster)
  return true
}

export function isUnknownAppError(message) {
  return !!message && (/unknown app/i.test(message) || /failed: 400\b/.test(message))
}

/**
 * Build the roster engine for an enabled vault config ({ vaultUrl, vaultToken,
 * accountId }). Its sync() pulls the roster; it resolves to whether the roster
 * changed, and never throws (the roster must not fail a lifeGLANCE cycle).
 */
export function createRosterEngine(vaultConfig, opts = {}) {
  const storage = opts.storage ?? localStorage
  let unsupported = false
  let changed = false
  const engine = (opts.createEngine ?? createDbSyncEngine)({
    storageKeyPrefix: STORAGE_PREFIX,
    appId: ROSTER_VAULT_APP,
    vaultApp: ROSTER_VAULT_APP,
    vaultUrl: vaultConfig.vaultUrl,
    vaultToken: vaultConfig.vaultToken,
    accountId: vaultConfig.accountId,
    deviceId: `${ensureDeviceId()}-roster`,
    ...DB_CRYPTO_CONFIG,
    vaultClient: opts.vaultClient,
    fetchImpl: opts.fetchImpl ?? nativeVaultFetchImpl(),
    pullCursorCommit: 'per-page',
    getLocalEntity: (id) => getLocalRosterEntity(storage, id),
    applyRemoteEntity: (id, entity) => { if (applyRosterEntity(storage, id, entity)) changed = true },
    applyRemoteDelete: (id) => { if (applyRosterDelete(storage, id)) changed = true },
    isInsertOnly: () => false,
    getEntityLastModified: (entity) => (isRosterEntity(entity) ? entity.updatedAt : undefined),
    onError: (message) => {
      if (isUnknownAppError(message)) {
        if (!unsupported) {
          unsupported = true
          console.warn('[roster] vault does not know glance-users yet; the household roster is not synced')
        }
        return
      }
      if (message) console.warn('[roster] vault sync error:', message)
    },
  })

  const sync = async () => {
    if (unsupported) return false
    changed = false
    try { await engine.sync() } catch (err) { console.warn('[roster] sync failed', err) }
    if (changed && typeof window !== 'undefined') window.dispatchEvent(new Event('lifeglance:roster-applied'))
    return changed
  }
  return { engine, sync }
}
