import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CONTAINERS, createICloudStore, pathSegments, realHomeDir, WATCHED_FILES, WRITE_SUPPRESSION_MS } from './icloud.js'

// The store over real files in a temp home, so it runs on any OS: on a Mac the
// same code meets ~/Library/Mobile Documents.

const SYNC = 'lifeglance-sync.json'

let home
const docs = (container = 'iCloud~com~lifeglance') => path.join(home, 'Library', 'Mobile Documents', container, 'Documents')
const makeContainer = (container) => fs.mkdirSync(docs(container), { recursive: true })

beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeglance-icloud-')) })
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }) })

describe('the containers', () => {
  it('are the iOS plugin\'s, as iCloud Drive spells them on disk', () => {
    const swift = fs.readFileSync(path.resolve(import.meta.dirname, '../ios/App/App/ICloudPlugin.swift'), 'utf-8')
    for (const [name, folder] of Object.entries(CONTAINERS)) {
      // iCloud.com.lifeglance is ~/Library/Mobile Documents/iCloud~com~lifeglance.
      expect(swift).toContain(`"${name}": "${folder.replaceAll('~', '.')}"`)
    }
    const watched = /static let watchedFiles = \[([^\]]*)\]/.exec(swift)?.[1] ?? ''
    expect([...WATCHED_FILES].sort()).toEqual([...watched.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort())
  })
})

describe('paths', () => {
  it('recovers the real home from the Mac App Store sandbox, and leaves a real one alone', () => {
    expect(realHomeDir('/Users/me/Library/Containers/com.lifeglance/Data')).toBe('/Users/me')
    expect(realHomeDir('/Users/me')).toBe('/Users/me')
  })

  it('confines paths to Documents, as the iOS plugin does', () => {
    expect(pathSegments('GLANCE/events/a.json')).toEqual(['GLANCE', 'events', 'a.json'])
    expect(pathSegments('./x//y')).toEqual(['x', 'y'])
    for (const bad of ['/etc/passwd', '../x', 'a/../../b', 'C:\\x', '\\x', 42, null, undefined]) expect(pathSegments(bad)).toBeNull()
  })
})

describe('availability', () => {
  it('is the own container existing, and nothing creates it', async () => {
    const store = createICloudStore({ home })
    expect(store.available()).toEqual({ available: false })
    expect(store.writeFile(SYNC, '{}', 'own')).toEqual({ ok: false, error: 'iCloud not available' })
    expect(await store.readFile(SYNC, 'own')).toEqual({ kind: 'error', error: 'iCloud not available' })
    expect(store.listFiles('', 'own')).toEqual({ names: null })
    expect(store.makeDir('GLANCE', 'own')).toEqual({ ok: false, error: 'iCloud not available' })
    expect(fs.existsSync(docs())).toBe(false)
    makeContainer()
    expect(store.available()).toEqual({ available: true })
  })

  it('is the own container, whatever dayGLANCE\'s is', () => {
    makeContainer('iCloud~com~dayglance')
    expect(createICloudStore({ home }).available()).toEqual({ available: false })
  })

  it('refuses an unknown container, and a name off Object.prototype', async () => {
    makeContainer()
    const store = createICloudStore({ home })
    expect(await store.readFile('x.json', 'elsewhere')).toEqual({ kind: 'error', error: 'iCloud not available' })
    expect(await store.readFile('x.json', 'constructor')).toEqual({ kind: 'error', error: 'iCloud not available' })
  })

  it('reads the sandbox-redirected home as the real one', () => {
    makeContainer()
    const sandboxed = path.join(home, 'Library', 'Containers', 'com.lifeglance', 'Data')
    expect(createICloudStore({ home: sandboxed }).available()).toEqual({ available: true })
  })
})

describe('reads', () => {
  beforeEach(() => makeContainer())

  it('classifies absent, text, empty and placeholder files', async () => {
    const requestDownload = vi.fn()
    const store = createICloudStore({ home, requestDownload })
    expect(await store.readFile(SYNC, 'own')).toEqual({ kind: 'absent' })
    fs.writeFileSync(path.join(docs(), SYNC), '{"v":1}')
    expect(await store.readFile(SYNC, 'own')).toEqual({ kind: 'text', text: '{"v":1}' })
    fs.writeFileSync(path.join(docs(), 'empty.json'), '')
    expect(await store.readFile('empty.json', 'own')).toEqual({ kind: 'downloading' })
    expect(requestDownload).not.toHaveBeenCalled()
    fs.writeFileSync(path.join(docs(), '.cloud-only.json.icloud'), 'bplist')
    expect(await store.readFile('cloud-only.json', 'own')).toEqual({ kind: 'downloading' })
    expect(requestDownload).toHaveBeenCalledWith(path.join(docs(), 'cloud-only.json'))
  })

  it('defaults to the own container', async () => {
    fs.writeFileSync(path.join(docs(), SYNC), '{"v":1}')
    expect(await createICloudStore({ home }).readFile(SYNC, undefined)).toEqual({ kind: 'text', text: '{"v":1}' })
  })

  it('answers an error for a folder, and for a path that names nothing', async () => {
    fs.mkdirSync(path.join(docs(), 'GLANCE'))
    const store = createICloudStore({ home })
    expect(await store.readFile('GLANCE', 'own')).toEqual({ kind: 'error', error: 'not a file' })
    expect(await store.readFile('', 'own')).toEqual({ kind: 'error', error: 'bad path' })
  })

  it('answers downloading for a second read of a file whose first has not returned', async () => {
    fs.writeFileSync(path.join(docs(), SYNC), '{"v":1}')
    const store = createICloudStore({ home })
    const first = store.readFile(SYNC, 'own')
    expect(await store.readFile(SYNC, 'own')).toEqual({ kind: 'downloading' })
    expect(await first).toEqual({ kind: 'text', text: '{"v":1}' })
    expect(await store.readFile(SYNC, 'own')).toEqual({ kind: 'text', text: '{"v":1}' })
  })

  it('answers downloading while macOS fetches a dataless file, and asks for it', async () => {
    fs.writeFileSync(path.join(docs(), SYNC), '{"v":1}')
    const requestDownload = vi.fn()
    const store = createICloudStore({ home, requestDownload })
    const spy = vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(Object.assign(new Error('EDEADLK: resource deadlock avoided, read'), { code: 'EDEADLK' }))
    try {
      expect(await store.readFile(SYNC, 'own')).toEqual({ kind: 'downloading' })
      expect(requestDownload).toHaveBeenCalledWith(path.join(docs(), SYNC))
      spy.mockRejectedValueOnce(Object.assign(new Error('EACCES: permission denied, read'), { code: 'EACCES' }))
      expect(await store.readFile(SYNC, 'own')).toEqual({ kind: 'error', error: 'EACCES: permission denied, read' })
    } finally {
      spy.mockRestore()
    }
    // The failed reads released the file: the next one is served.
    expect(await store.readFile(SYNC, 'own')).toEqual({ kind: 'text', text: '{"v":1}' })
  })

  it('reads the dayglance container by path, and refuses a path outside it', async () => {
    makeContainer('iCloud~com~dayglance')
    fs.mkdirSync(path.join(docs('iCloud~com~dayglance'), 'GLANCE/events'), { recursive: true })
    fs.writeFileSync(path.join(docs('iCloud~com~dayglance'), 'GLANCE/events/e1.json'), '{"e":1}')
    const store = createICloudStore({ home })
    expect(await store.readFile('GLANCE/events/e1.json', 'dayglance')).toEqual({ kind: 'text', text: '{"e":1}' })
    expect(await store.readFile('../../../escape.json', 'dayglance')).toEqual({ kind: 'error', error: 'bad path' })
  })
})

describe('writes', () => {
  beforeEach(() => makeContainer())

  it('replaces the content in place, keeping the inode the iCloud daemon tracks', () => {
    const store = createICloudStore({ home })
    const file = path.join(docs(), SYNC)
    fs.writeFileSync(file, 'a much longer first version of the file')
    const inode = fs.statSync(file).ino
    expect(store.writeFile(SYNC, '{"v":2}', 'own')).toEqual({ ok: true })
    expect(fs.readFileSync(file, 'utf-8')).toBe('{"v":2}')
    expect(fs.statSync(file).ino).toBe(inode)
    expect(fs.readdirSync(docs())).toEqual([SYNC])
  })

  it('writes text only', () => {
    const store = createICloudStore({ home })
    expect(store.writeFile(SYNC, undefined, 'own')).toEqual({ ok: false, error: 'missing text' })
    expect(store.writeFile(SYNC, { v: 1 }, 'own')).toEqual({ ok: false, error: 'missing text' })
    expect(fs.existsSync(path.join(docs(), SYNC))).toBe(false)
  })

  it('creates folders inside the container, lists, and deletes', () => {
    const store = createICloudStore({ home })
    expect(store.makeDir('GLANCE/events', 'own')).toEqual({ ok: true })
    expect(store.writeFile('GLANCE/events/b.json', '{}', 'own')).toEqual({ ok: true })
    fs.writeFileSync(path.join(docs(), 'GLANCE/events/.c.json.icloud'), 'x')
    fs.writeFileSync(path.join(docs(), 'GLANCE/events/.DS_Store'), 'x')
    expect(store.listFiles('GLANCE/events', 'own').names?.sort()).toEqual(['b.json', 'c.json'])
    expect(store.listFiles('GLANCE/missing', 'own')).toEqual({ names: [] })
    expect(store.listFiles('', 'own')).toEqual({ names: ['GLANCE'] })
    expect(store.deleteFile('GLANCE/events/b.json', 'own')).toEqual({ ok: true })
    expect(store.deleteFile('GLANCE/events/b.json', 'own')).toEqual({ ok: true })
    expect(store.writeFile('../outside.json', '{}', 'own')).toEqual({ ok: false, error: 'bad path' })
    expect(store.deleteFile('../outside.json', 'own')).toEqual({ ok: false, error: 'bad path' })
    expect(fs.existsSync(path.join(docs(), '..', 'outside.json'))).toBe(false)
  })
})

describe('watching', () => {
  it('reports a change to the sync file made elsewhere, not its own writes, and waits for the folder', async () => {
    let t = 1_000_000
    const store = createICloudStore({ home, now: () => t })
    const onChange = vi.fn()
    const stop = store.watch(onChange)
    try {
      makeContainer() // appears after watching began: re-attached within 5 s
      await new Promise((r) => setTimeout(r, 5500))
      store.writeFile(SYNC, '{"mine":true}', 'own')
      await new Promise((r) => setTimeout(r, 1300))
      expect(onChange).not.toHaveBeenCalled()
      t += WRITE_SUPPRESSION_MS + 1
      fs.writeFileSync(path.join(docs(), SYNC), '{"theirs":true}')
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 4000 })
      fs.writeFileSync(path.join(docs(), 'unrelated.json'), '{}')
      await new Promise((r) => setTimeout(r, 1300))
      expect(onChange).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
  }, 20_000)

  it('stops: nothing is reported after the stop function runs', async () => {
    makeContainer()
    const onChange = vi.fn()
    const stop = createICloudStore({ home }).watch(onChange)
    stop()
    fs.writeFileSync(path.join(docs(), SYNC), '{"theirs":true}')
    await new Promise((r) => setTimeout(r, 1300))
    expect(onChange).not.toHaveBeenCalled()
  })
})
