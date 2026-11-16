// From dayGLANCE electron/directAccessStore.test.ts (krelltunez/dayGLANCE@8d72008).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createDirectAccessStore, describeFolderError, resolveInside, SYNC_FILE, WRITE_SUPPRESSION_MS } from './directAccessStore.js'

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-direct-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

const file = () => path.join(dir, SYNC_FILE)
const snapshot = (n) => JSON.stringify({ version: 2, lastModified: `2026-10-0${n}T00:00:00.000Z`, data: { tasks: [] } })

describe('read classification', () => {
  it('reports no folder when nothing is connected', () => {
    const store = createDirectAccessStore()
    expect(store.read()).toEqual({ kind: 'error', error: 'no folder connected' })
    expect(store.reachable()).toBe(false)
  })

  it('an absent file is absent: the renderer may seed it', () => {
    const store = createDirectAccessStore()
    store.setBase(dir)
    expect(store.read()).toEqual({ kind: 'absent' })
    expect(store.reachable()).toBe(true)
  })

  it('guard: a zero-length file is a placeholder, never absent', () => {
    // Drive streaming, OneDrive Files On-Demand and Dropbox online-only all
    // materialise a cloud-only file as an empty entry; so does a tool that has
    // truncated the file and not yet written it. Seeding over it would ship an
    // empty-history snapshot to every device.
    const store = createDirectAccessStore()
    store.setBase(dir)
    fs.writeFileSync(file(), '')
    expect(store.read()).toEqual({ kind: 'downloading' })
  })

  it('returns the content of a real file', () => {
    const store = createDirectAccessStore()
    store.setBase(dir)
    fs.writeFileSync(file(), snapshot(1))
    expect(store.read()).toEqual({ kind: 'text', text: snapshot(1) })
  })

  it('a folder that vanished is an error, not an absent file', () => {
    const store = createDirectAccessStore()
    const sub = path.join(dir, 'GLANCE')
    fs.mkdirSync(sub)
    store.setBase(sub)
    fs.writeFileSync(path.join(sub, SYNC_FILE), snapshot(1))
    expect(store.read().kind).toBe('text')
    fs.rmSync(sub, { recursive: true, force: true })
    expect(store.read()).toEqual({ kind: 'error', error: 'folder not found' })
    expect(store.reachable()).toBe(false)
  })

  it('a folder path that is a file is an error', () => {
    const store = createDirectAccessStore()
    const notDir = path.join(dir, 'file.txt')
    fs.writeFileSync(notDir, 'x')
    store.setBase(notDir)
    expect(store.read()).toEqual({ kind: 'error', error: 'folder not found' })
  })

  it('a snapshot path that is a directory is an error', () => {
    const store = createDirectAccessStore()
    store.setBase(dir)
    fs.mkdirSync(file())
    expect(store.read()).toEqual({ kind: 'error', error: `${SYNC_FILE} is not a file` })
  })

  it('describeFolderError keeps paths out of the message', () => {
    const enoent = Object.assign(new Error('ENOENT: no such file or directory, stat /Users/x/Drive'), { code: 'ENOENT' })
    expect(describeFolderError(enoent)).toBe('folder not found')
    const eacces = Object.assign(new Error('EACCES: permission denied, open /x'), { code: 'EACCES' })
    expect(describeFolderError(eacces)).toBe('permission denied')
    expect(describeFolderError(new Error('weird'))).toBe('weird')
    expect(describeFolderError(undefined)).toBe('folder unavailable')
  })
})

describe('read cache', () => {
  it('serves an unchanged file from cache and re-reads when size or mtime move', () => {
    const store = createDirectAccessStore()
    store.setBase(dir)
    fs.writeFileSync(file(), snapshot(1))
    const spy = vi.spyOn(fs, 'readFileSync')
    try {
      expect(store.read()).toEqual({ kind: 'text', text: snapshot(1) })
      expect(store.read()).toEqual({ kind: 'text', text: snapshot(1) })
      expect(spy).toHaveBeenCalledTimes(1)

      // Another device's copy lands: different size, so it is read again.
      fs.writeFileSync(file(), snapshot(2) + ' ')
      expect(store.read()).toEqual({ kind: 'text', text: snapshot(2) + ' ' })
      expect(spy).toHaveBeenCalledTimes(2)

      // Same size, different mtime (a rewrite with identical length).
      const past = new Date(Date.now() - 60_000)
      fs.utimesSync(file(), past, past)
      expect(store.read()).toEqual({ kind: 'text', text: snapshot(2) + ' ' })
      expect(spy).toHaveBeenCalledTimes(3)
    } finally {
      spy.mockRestore()
    }
  })

  it('our own write invalidates the cache', () => {
    const store = createDirectAccessStore()
    store.setBase(dir)
    fs.writeFileSync(file(), snapshot(1))
    expect(store.read().kind).toBe('text')
    expect(store.write(snapshot(2))).toBe(true)
    expect(store.read()).toEqual({ kind: 'text', text: snapshot(2) })
  })

  it('changing folders clears the cache', () => {
    const store = createDirectAccessStore()
    const other = path.join(dir, 'other')
    fs.mkdirSync(other)
    store.setBase(dir)
    fs.writeFileSync(file(), snapshot(1))
    expect(store.read().kind).toBe('text')
    store.setBase(other)
    expect(store.read()).toEqual({ kind: 'absent' })
  })
})

describe('write and remove', () => {
  it('writes atomically into the folder and leaves no temp file', () => {
    const store = createDirectAccessStore()
    store.setBase(dir)
    expect(store.write(snapshot(1))).toBe(true)
    expect(fs.readFileSync(file(), 'utf-8')).toBe(snapshot(1))
    expect(fs.readdirSync(dir)).toEqual([SYNC_FILE])
  })

  it('refuses to write with no folder connected', () => {
    const store = createDirectAccessStore({ log: { warn: () => {} } })
    expect(store.write('x')).toBe(false)
  })

  it('reports a failed write without throwing', () => {
    const warn = vi.fn()
    const store = createDirectAccessStore({ log: { warn } })
    store.setBase(path.join(dir, 'missing', 'deeper'))
    // mkdir recursive creates the parents, so make the parent a FILE to force failure.
    fs.writeFileSync(path.join(dir, 'missing'), 'not a dir')
    expect(store.write('x')).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('remove deletes the snapshot, and a missing file counts as removed', () => {
    const store = createDirectAccessStore()
    store.setBase(dir)
    fs.writeFileSync(file(), snapshot(1))
    expect(store.remove()).toBe(true)
    expect(fs.existsSync(file())).toBe(false)
    expect(store.remove()).toBe(true)
    expect(store.read()).toEqual({ kind: 'absent' })
  })
})

describe('watcher', () => {
  it('fires for a change made by someone else, not for our own write, and stops on stopWatch', async () => {
    let t = 1_000_000
    const store = createDirectAccessStore({ now: () => t })
    store.setBase(dir)
    const onChange = vi.fn()
    store.startWatch(onChange)
    try {
      // Our own write inside the suppression window: ignored.
      store.write(snapshot(1))
      await new Promise((r) => setTimeout(r, 1300))
      expect(onChange).not.toHaveBeenCalled()

      // Someone else's write, after the window.
      t += WRITE_SUPPRESSION_MS + 1
      fs.writeFileSync(file(), snapshot(2))
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 4000 })

      // A different file in the folder is ignored.
      fs.writeFileSync(path.join(dir, 'other.json'), '{}')
      await new Promise((r) => setTimeout(r, 1300))
      expect(onChange).toHaveBeenCalledTimes(1)

      store.stopWatch()
      fs.writeFileSync(file(), snapshot(3))
      await new Promise((r) => setTimeout(r, 1300))
      expect(onChange).toHaveBeenCalledTimes(1)
    } finally {
      store.stopWatch()
    }
  }, 15_000)

  it('survives a folder change: the watcher follows setBase', async () => {
    let t = 1_000_000
    const store = createDirectAccessStore({ now: () => t })
    const other = path.join(dir, 'other')
    fs.mkdirSync(other)
    store.setBase(dir)
    const onChange = vi.fn()
    store.startWatch(onChange)
    try {
      store.setBase(other)
      t += WRITE_SUPPRESSION_MS + 1
      fs.writeFileSync(path.join(other, SYNC_FILE), snapshot(1))
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 4000 })
      // The old folder no longer reports.
      fs.writeFileSync(file(), snapshot(2))
      await new Promise((r) => setTimeout(r, 1300))
      expect(onChange).toHaveBeenCalledTimes(1)
    } finally {
      store.stopWatch()
    }
  }, 15_000)
})

describe('files by path, confined to the folder (Phase 5)', () => {
  it('guard: a path that escapes the folder is refused by every operation', () => {
    const store = createDirectAccessStore()
    store.setBase(dir)
    const outside = path.join(dir, '..', 'escaped.json')
    for (const rel of ['../escaped.json', '/etc/passwd', 'GLANCE/../../escaped.json', path.resolve(dir, '..', 'x')]) {
      expect(store.readFile(rel).kind).toBe('error')
      expect(store.writeFile(rel, '{}')).toBe(false)
      expect(store.deleteFile(rel)).toBe(false)
      expect(store.makeDir(rel)).toBe(false)
      expect(store.listFiles(rel)).toBeNull()
    }
    expect(fs.existsSync(outside)).toBe(false)
    // The folder itself is a directory, not a file: readable as a listing only.
    expect(store.readFile('.').kind).toBe('error')
    expect(store.writeFile('', '{}')).toBe(false)
    expect(store.listFiles('.')).toEqual([])
  })

  it('resolveInside admits the folder and what is below it, nothing else', () => {
    expect(resolveInside(dir, 'GLANCE/users/glance-users.json')).toBe(path.join(dir, 'GLANCE', 'users', 'glance-users.json'))
    expect(resolveInside(dir, '')).toBe(path.resolve(dir))
    expect(resolveInside(dir, '..')).toBeNull()
    expect(resolveInside(dir, 'a/../..')).toBeNull()
    expect(resolveInside(dir, path.dirname(path.resolve(dir)))).toBeNull()
    expect(resolveInside(dir, 42)).toBeNull()
    // A sibling folder whose name merely starts with the folder's is outside.
    expect(resolveInside(dir, path.resolve(dir) + '-other/x')).toBeNull()
  })

  it('the roster round trip: absent, written with its parents, read back, listed, deleted', () => {
    const store = createDirectAccessStore()
    store.setBase(dir)
    const rel = 'GLANCE/users/glance-users.json'
    expect(store.readFile(rel)).toEqual({ kind: 'absent' })
    expect(store.listFiles('GLANCE/users')).toEqual([])
    expect(store.writeFile(rel, '{"version":1,"users":[]}')).toBe(true)
    expect(store.readFile(rel)).toEqual({ kind: 'text', text: '{"version":1,"users":[]}' })
    expect(store.listFiles('GLANCE/users')).toEqual(['glance-users.json'])
    expect(store.makeDir('GLANCE/events')).toBe(true)
    expect(store.listFiles('GLANCE')).toEqual([]) // directories are not files
    expect(store.deleteFile(rel)).toBe(true)
    expect(store.deleteFile(rel)).toBe(true) // idempotent
    expect(store.readFile(rel)).toEqual({ kind: 'absent' })
  })

  it('classifies a path read like the snapshot: a placeholder is downloading, a directory is an error, no folder is an error', () => {
    const store = createDirectAccessStore()
    expect(store.readFile('x.json')).toEqual({ kind: 'error', error: 'no folder connected' })
    expect(store.listFiles('.')).toBeNull()
    store.setBase(dir)
    fs.mkdirSync(path.join(dir, 'GLANCE'))
    fs.writeFileSync(path.join(dir, 'GLANCE', 'empty.json'), '')
    expect(store.readFile('GLANCE/empty.json')).toEqual({ kind: 'downloading' })
    expect(store.readFile('GLANCE').kind).toBe('error')
    const sub = path.join(dir, 'gone')
    fs.mkdirSync(sub)
    store.setBase(sub)
    fs.rmSync(sub, { recursive: true, force: true })
    expect(store.readFile('x.json')).toEqual({ kind: 'error', error: 'folder not found' })
    expect(store.writeFile('x.json', '{}')).toBe(false)
  })
})
