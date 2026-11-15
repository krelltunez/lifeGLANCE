import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

// Life photos (Lives Phase 3b): kept locally; uploaded to GLANCEvault when it
// is on, with the references written only after the upload succeeds.

const vault = { on: false, fail: false, released: [] }
vi.mock('../../sync/dbSync', () => ({ readVaultConfig: () => (vault.on ? { vaultUrl: 'x' } : null) }))
vi.mock('../../blobs/milestoneMedia.js', () => ({
  isRealBlobHash: (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v),
  uploadMilestoneMedia: async () => { if (vault.fail) throw new Error('offline'); return { fullHash: 'a'.repeat(64), thumbHash: 'b'.repeat(64) } },
  releaseMilestoneMedia: async (rec) => { vault.released.push(rec.photo_id) },
  fetchThumbnailBytes: async () => null,
  fetchFullResBytes: async () => null,
}))

beforeEach(() => {
  global.indexedDB = new IDBFactory()
  const store = new Map()
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() }
  Object.assign(vault, { on: false, fail: false, released: [] })
  vi.resetModules()
})

async function setup() {
  const db = await import('../../data/db')
  await db.initDB()
  const lives = await import('../../data/lives')
  const photo = await import('./lifePhoto')
  return { db, lives, photo }
}

const file = () => new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' })

describe('Life photos', () => {
  it('without the vault: kept on this device with a placeholder reference', async () => {
    const { db, lives, photo } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    const u = await photo.saveLifePhoto(mom, file())
    expect(u.photo_id).toBe(`${mom.id}-photo`)
    expect(await db.dbGetPhoto(mom.id)).not.toBeNull()
  })

  it('with the vault: the references point at the uploaded blobs', async () => {
    vault.on = true
    const { lives, photo } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    const u = await photo.saveLifePhoto(mom, file())
    expect(u.photo_id).toBe('a'.repeat(64))
    expect(u.thumbnail_id).toBe('b'.repeat(64))
  })

  it('a failed upload keeps the local photo and the placeholder', async () => {
    Object.assign(vault, { on: true, fail: true })
    const { db, lives, photo } = await setup()
    const mom = await lives.createLife({ name: 'Mom' })
    const u = await photo.saveLifePhoto(mom, file())
    expect(u.photo_id).toBe(`${mom.id}-photo`)
    expect(await db.dbGetPhoto(mom.id)).not.toBeNull()
  })

  it('removing it clears the local copy, the references, and releases the vault ones', async () => {
    vault.on = true
    const { db, lives, photo } = await setup()
    const withPhoto = await photo.saveLifePhoto(await lives.createLife({ name: 'Mom' }), file())
    const u = await photo.removeLifePhoto(withPhoto)
    expect(u.photo_id).toBeNull()
    expect(await db.dbGetPhoto(u.id)).toBeNull()
    expect(vault.released).toContain('a'.repeat(64))
  })

  it("works for Me too, without touching Me's name", async () => {
    const { lives, photo } = await setup()
    const me = await lives.getLife('me')
    const u = await photo.saveLifePhoto(me, file())
    expect(u.name).toBe('Me')
    expect(u.photo_id).toBe('me-photo')
  })
})
