import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSecureStore, secureStorageUsable } from './secureStore.js'

// A stand-in for safeStorage: reversible, so the file never holds the plaintext.
const cipher = {
  encrypt: (plain) => Buffer.from(`enc:${Buffer.from(plain).toString('hex')}`),
  decrypt: (buf) => {
    const s = buf.toString()
    if (!s.startsWith('enc:')) throw new Error('cannot decrypt')
    return Buffer.from(s.slice(4), 'hex').toString()
  },
}

let dir
let file
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeglance-secure-'))
  file = path.join(dir, 'secure-store.json')
})
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('secure store', () => {
  it('round-trips across restarts, and keeps no plaintext on disk', () => {
    createSecureStore({ file, cipher }).set('lifeglance-vault-config', '{"vaultToken":"s3cret"}')
    expect(createSecureStore({ file, cipher }).get('lifeglance-vault-config')).toEqual({ value: '{"vaultToken":"s3cret"}' })
    expect(fs.readFileSync(file, 'utf-8')).not.toContain('s3cret')
  })

  it('reads an unknown key as absent, and deletes', () => {
    const store = createSecureStore({ file, cipher })
    expect(store.get('nope')).toEqual({ value: null })
    store.set('k', 'v')
    store.delete('k')
    expect(createSecureStore({ file, cipher }).get('k')).toEqual({ value: null })
  })

  it('reads what this machine cannot decrypt as absent, as on the phones', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, items: { k: Buffer.from('from another machine').toString('base64') } }))
    expect(createSecureStore({ file, cipher }).get('k')).toEqual({ value: null })
  })

  it('starts empty from a corrupt or foreign file', () => {
    fs.writeFileSync(file, '{ not json')
    expect(createSecureStore({ file, cipher }).get('k')).toEqual({ value: null })
    fs.writeFileSync(file, JSON.stringify({ version: 2, items: { k: 'x' } }))
    expect(createSecureStore({ file, cipher }).get('k')).toEqual({ value: null })
  })

  it('refuses malformed keys and values from IPC', () => {
    const store = createSecureStore({ file, cipher })
    expect(() => store.set('', 'v')).toThrow()
    expect(() => store.set('k'.repeat(201), 'v')).toThrow()
    expect(() => store.set('k', 42)).toThrow()
    expect(store.get(42)).toEqual({ value: null })
    expect(() => store.delete(undefined)).not.toThrow()
  })
})

describe('secureStorageUsable', () => {
  it('trusts the macOS Keychain and Windows DPAPI when available', () => {
    expect(secureStorageUsable('darwin', true)).toBe(true)
    expect(secureStorageUsable('win32', true)).toBe(true)
    expect(secureStorageUsable('darwin', false)).toBe(false)
  })

  it('on Linux, only with a real keyring backend', () => {
    expect(secureStorageUsable('linux', true, 'gnome_libsecret')).toBe(true)
    expect(secureStorageUsable('linux', true, 'kwallet5')).toBe(true)
    expect(secureStorageUsable('linux', true, 'basic_text')).toBe(false)
    expect(secureStorageUsable('linux', true, 'unknown')).toBe(false)
    expect(secureStorageUsable('linux', false, 'gnome_libsecret')).toBe(false)
  })
})
