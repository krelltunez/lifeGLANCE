import { describe, it, expect, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}))

import { createDirectAccessBridge, isDirectAccessAvailable } from './directAccess'

// The bridge shape the shared file transport consumes (dayGLANCE's
// src/sync/directAccessNativeBridge.js produces the same one from its shells),
// over a fake of the plugin both shells implement.

const status = { configured: true, name: 'GLANCE', path: '/x/GLANCE', reachable: true }
const fakePlugin = (over = {}) => ({
  status: vi.fn(async () => status),
  pickFolder: vi.fn(async () => status),
  pickFile: vi.fn(async ({ slot }) => ({ ...status, slot })),
  createFile: vi.fn(async ({ slot }) => ({ ...status, slot })),
  disconnect: vi.fn(async () => {}),
  read: vi.fn(async () => ({ kind: 'text', text: '{"version":2}' })),
  write: vi.fn(async () => ({ ok: true })),
  deleteFile: vi.fn(async () => ({ ok: true })),
  listFiles: vi.fn(async () => ({ names: ['glance-users.json'] })),
  readFile: vi.fn(async () => ({ kind: 'absent' })),
  writeFile: vi.fn(async () => ({ ok: true })),
  deleteFileAt: vi.fn(async () => ({ ok: false })),
  makeDir: vi.fn(async () => ({ ok: true })),
  usersStatus: vi.fn(async () => ({ ...status, name: 'glance-users.json' })),
  readUsers: vi.fn(async () => ({ kind: 'error', error: 'no roster file chosen' })),
  writeUsers: vi.fn(async () => ({ ok: true })),
  forgetUsers: vi.fn(async () => {}),
  eventsStatus: vi.fn(async () => ({ ...status, configured: false })),
  readEvents: vi.fn(async () => ({ kind: 'text', text: '{"version":1,"events":[]}' })),
  writeEvents: vi.fn(async () => ({ ok: false })),
  forgetEvents: vi.fn(async () => { throw new Error('nope') }),
  ...over,
})

describe('isDirectAccessAvailable', () => {
  it('is false outside a shell that registered the plugin', () => {
    expect(isDirectAccessAvailable()).toBe(false)
  })
})

describe('createDirectAccessBridge', () => {
  it('Android: the folder, the snapshot, and files by path; no bookmarked slots', async () => {
    const p = fakePlugin()
    const b = createDirectAccessBridge(p, 'android')
    expect(await b.restore()).toEqual(status)
    expect(await b.pick()).toEqual(status)
    expect(p.pickFolder).toHaveBeenCalled()
    expect(await b.read()).toEqual({ kind: 'text', text: '{"version":2}' })
    expect(await b.write('{}')).toBe(true)
    expect(p.write).toHaveBeenCalledWith({ text: '{}' })
    expect(await b.deleteFile()).toBe(true)
    expect(await b.disconnect()).toBe(true)
    expect(await b.paths.list('GLANCE/users')).toEqual(['glance-users.json'])
    expect(await b.paths.read('GLANCE/users/glance-users.json')).toEqual({ kind: 'absent' })
    expect(await b.paths.write('GLANCE/users/glance-users.json', '{}')).toBe(true)
    expect(p.writeFile).toHaveBeenCalledWith({ rel: 'GLANCE/users/glance-users.json', text: '{}' })
    expect(await b.paths.remove('x')).toBe(false)
    expect(await b.paths.makeDir('GLANCE/users')).toBe(true)
    expect(b.users).toBeUndefined()
    expect(b.events).toBeUndefined()
  })

  it('Android: a refused listing is null, a bad read answer is an error, never a crash', async () => {
    const p = fakePlugin({ listFiles: vi.fn(async () => ({ names: null })), readFile: vi.fn(async () => ({})) })
    const b = createDirectAccessBridge(p, 'android')
    expect(await b.paths.list('..')).toBeNull()
    expect(await b.paths.read('x')).toEqual({ kind: 'error', error: 'bad answer from the shell' })
  })

  it('iOS: picks are of files with a slot, and the roster and event set are their own slots; no files by path', async () => {
    const p = fakePlugin()
    const b = createDirectAccessBridge(p, 'ios')
    expect(await b.pick()).toMatchObject({ slot: 'snapshot' })
    expect(p.pickFile).toHaveBeenCalledWith({ slot: 'snapshot' })
    expect(await b.pickFile('users')).toMatchObject({ slot: 'users' })
    expect(await b.createFile('events')).toMatchObject({ slot: 'events' })
    expect(b.paths).toBeUndefined()
    expect(await b.users.status()).toMatchObject({ name: 'glance-users.json' })
    expect(await b.users.read()).toEqual({ kind: 'error', error: 'no roster file chosen' })
    expect(await b.users.write('{"users":[]}')).toBe(true)
    expect(p.writeUsers).toHaveBeenCalledWith({ text: '{"users":[]}' })
    expect(await b.users.forget()).toBe(true)
    expect(await b.events.status()).toMatchObject({ configured: false })
    expect(await b.events.read()).toEqual({ kind: 'text', text: '{"version":1,"events":[]}' })
    expect(await b.events.write('x')).toBe(false)
    expect(await b.events.forget()).toBe(false)                     // a throwing shell: reported, not thrown
  })

  it('a dismissed picker is null; a refused pick carries the shell\'s reason and path', async () => {
    const p = fakePlugin({
      pickFolder: vi.fn(async () => ({ cancelled: true })),
      pickFile: vi.fn(async () => { const e = new Error('that is not lifeglance-sync.json'); e.data = { path: '/x/notes.json' }; throw e }),
    })
    expect(await createDirectAccessBridge(p, 'android').pick()).toBeNull()
    expect(await createDirectAccessBridge(p, 'ios').pick()).toEqual({ error: 'that is not lifeglance-sync.json', path: '/x/notes.json' })
  })
})
