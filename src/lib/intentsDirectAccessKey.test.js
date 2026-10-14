import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { chooseSalt, keyForSalt, resolveDirectAccessIntentsKey, ensureDirectAccessIntentsKey, readOwnSalt, writeOwnSalt, DIRECT_ACCESS_INTENTS_SALT_KEY } from './intentsDirectAccessKey.js'
import { serializeEventSet } from './intentsEventSet.js'

function memStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v) }, removeItem: (k) => { m.delete(k) } }
}
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memStorage() }) })
afterAll(() => { delete globalThis.localStorage })

const SALT_A = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)))
const SALT_B = btoa(String.fromCharCode(...new Uint8Array(16).fill(2)))
const transportOver = (text) => ({ events: { supported: () => true, read: async () => text, write: async () => true } })

describe('chooseSalt', () => {
  it("the file's salt wins; then this device's; then WebDAV's; then a new one", () => {
    const random = () => 'NEW'
    expect(chooseSalt({ fileSalt: 'F', ownSalt: 'O', webdavSalt: 'W', random })).toBe('F')
    expect(chooseSalt({ fileSalt: null, ownSalt: 'O', webdavSalt: 'W', random })).toBe('O')
    expect(chooseSalt({ fileSalt: null, ownSalt: null, webdavSalt: 'W', random })).toBe('W')
    expect(chooseSalt({ fileSalt: null, ownSalt: null, webdavSalt: null, random })).toBe('NEW')
  })
})

describe('keyForSalt', () => {
  it('uses the cached key for the same salt, derives and caches from the passphrase for another, and answers null without either', async () => {
    const store = { record: null }
    const loadCached = async () => store.record
    const storeCached = vi.fn(async (r) => { store.record = r })
    expect(await keyForSalt(SALT_A, { passphrase: null, loadCached, storeCached })).toBeNull()
    const k1 = await keyForSalt(SALT_A, { passphrase: 'pw', loadCached, storeCached })
    expect(k1).toBeTruthy()
    expect(storeCached).toHaveBeenCalledTimes(1)
    expect(await keyForSalt(SALT_A, { passphrase: null, loadCached, storeCached })).toBe(k1)
    expect(await keyForSalt(SALT_B, { passphrase: null, loadCached, storeCached })).toBeNull()
    expect(await keyForSalt(SALT_B, { passphrase: 'pw', loadCached, storeCached })).toBeTruthy()
    expect(store.record.saltB64).toBe(SALT_B)
    expect(await keyForSalt(null, { passphrase: 'pw', loadCached, storeCached })).toBeNull()
  })
})

describe('resolveDirectAccessIntentsKey', () => {
  it("adopts the salt the file names and remembers it; brings its own, WebDAV's or a new one to a file without", async () => {
    const store = { record: null }
    const deps = { loadCached: async () => store.record, storeCached: async (r) => { store.record = r }, passphrase: 'pw', random: () => 'NEW' }
    const r1 = await resolveDirectAccessIntentsKey({ transport: transportOver(serializeEventSet([], 'x', SALT_A)), ...deps })
    expect(r1.salt).toBe(SALT_A)
    expect(r1.key).toBeTruthy()
    expect(readOwnSalt()).toBe(SALT_A)
    // The file lost its salt (a conflicted copy): this device brings the same one back.
    const r2 = await resolveDirectAccessIntentsKey({ transport: transportOver(serializeEventSet([])), ...deps, webdavSalt: async () => 'W' })
    expect(r2.salt).toBe(SALT_A)
    expect(r2.key).toBe(r1.key)
    writeOwnSalt(null)
    expect((await resolveDirectAccessIntentsKey({ transport: transportOver(null), ...deps, webdavSalt: async () => SALT_B })).salt).toBe(SALT_B)
    writeOwnSalt(null)
    expect((await resolveDirectAccessIntentsKey({ transport: transportOver(null), ...deps })).salt).toBe('NEW')
    expect(localStorage.getItem(DIRECT_ACCESS_INTENTS_SALT_KEY)).toBe('NEW')
  })

  it('answers the salt with no key when no passphrase is in memory and nothing cached matches', async () => {
    const r = await resolveDirectAccessIntentsKey({ transport: transportOver(serializeEventSet([], 'x', SALT_A)), loadCached: async () => null, storeCached: async () => {}, passphrase: null })
    expect(r).toEqual({ salt: SALT_A, key: null })
  })
})

describe('ensureDirectAccessIntentsKey', () => {
  it('is ready from memory, asks once otherwise, and never enables on a cancel', async () => {
    const key = {}
    expect(await ensureDirectAccessIntentsKey({ resolve: async () => ({ salt: 's', key }), promptForPassphrase: async () => { throw new Error('not asked') } })).toEqual({ status: 'ready' })
    const prompt = vi.fn(async () => 'pw')
    expect(await ensureDirectAccessIntentsKey({ resolve: async (p) => ({ salt: 's', key: p ? key : null }), promptForPassphrase: prompt })).toEqual({ status: 'ready' })
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(await ensureDirectAccessIntentsKey({ resolve: async () => ({ salt: 's', key: null }), promptForPassphrase: async () => null })).toEqual({ status: 'cancelled' })
  })
})
