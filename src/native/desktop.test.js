import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopBridge, desktopLog, installDesktopShell, isDesktop } from './desktop.js'

// The page's side of the desktop bridge: found only inside the shell, and wired
// up once at boot. A minimal document stands in for the real one (the suite
// runs in Node).

function fakeBridge(platform = 'darwin') {
  const wakeListeners = new Set()
  return {
    info: { platform },
    shell: {
      setTheme: vi.fn(),
      log: vi.fn(),
      onWake: vi.fn((listener) => { wakeListeners.add(listener); return () => wakeListeners.delete(listener) }),
    },
    wake: (why) => { for (const l of wakeListeners) l(why) },
    wakeListeners,
  }
}

function fakeDocument(theme = 'dark') {
  const classes = new Set()
  const attrs = new Map([['data-theme', theme]])
  let observerCallback = null
  const events = []
  class Observer {
    constructor(cb) { observerCallback = cb }
    observe() {}
    disconnect() { observerCallback = null }
  }
  return {
    documentElement: {
      classList: { add: (...names) => names.forEach((n) => classes.add(n)) },
      getAttribute: (name) => attrs.get(name) ?? null,
    },
    defaultView: { MutationObserver: Observer },
    dispatchEvent: (e) => { events.push(e.type); return true },
    classes, events,
    setTheme: (t) => { attrs.set('data-theme', t); observerCallback?.() },
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('desktopBridge', () => {
  it('is null on the web, the phones and in Node', () => {
    expect(desktopBridge()).toBeNull()
    vi.stubGlobal('window', {})
    expect(desktopBridge()).toBeNull()
    expect(isDesktop()).toBe(false)
  })

  it('is the preload\'s object inside the shell', () => {
    const bridge = fakeBridge('linux')
    vi.stubGlobal('window', { lifeGlanceDesktop: bridge })
    expect(desktopBridge()).toBe(bridge)
    expect(isDesktop()).toBe(true)
  })

  it('ignores anything that is not the bridge', () => {
    for (const impostor of [null, 'yes', {}, { info: { platform: 'ios' }, shell: { setTheme() {} } }, { info: { platform: 'darwin' }, shell: {} }]) {
      vi.stubGlobal('window', { lifeGlanceDesktop: impostor })
      expect(desktopBridge()).toBeNull()
    }
  })
})

describe('desktopLog', () => {
  it('writes a line through the shell, and is silent anywhere else', () => {
    expect(() => desktopLog('nowhere to go')).not.toThrow()
    const bridge = fakeBridge()
    vi.stubGlobal('window', { lifeGlanceDesktop: bridge })
    desktopLog('icloud: merged')
    expect(bridge.shell.log).toHaveBeenCalledWith('icloud: merged')
  })

  it('never throws, whatever the shell does', () => {
    const bridge = fakeBridge()
    bridge.shell.log = () => { throw new Error('ipc closed') }
    vi.stubGlobal('window', { lifeGlanceDesktop: bridge })
    expect(() => desktopLog('x')).not.toThrow()
  })
})

describe('installDesktopShell', () => {
  it('does nothing where there is no shell', () => {
    const doc = fakeDocument()
    expect(() => installDesktopShell({ bridge: null, doc })()).not.toThrow()
    expect(doc.classes.size).toBe(0)
  })

  it('marks the document as the desktop app, by platform', () => {
    const doc = fakeDocument()
    installDesktopShell({ bridge: fakeBridge('win32'), doc })
    expect([...doc.classes]).toEqual(['desktop', 'desktop-win32'])
  })

  it('reports the theme at once and on every change', () => {
    const bridge = fakeBridge()
    const doc = fakeDocument('dark')
    installDesktopShell({ bridge, doc })
    expect(bridge.shell.setTheme.mock.calls).toEqual([[true]])
    doc.setTheme('light')
    doc.setTheme('dark')
    expect(bridge.shell.setTheme.mock.calls).toEqual([[true], [false], [true]])
  })

  it('replays a wake from the shell as visibilitychange', () => {
    const bridge = fakeBridge()
    const doc = fakeDocument()
    installDesktopShell({ bridge, doc })
    bridge.wake('resume')
    bridge.wake('unlock')
    expect(doc.events).toEqual(['visibilitychange', 'visibilitychange'])
  })

  it('undoes its listeners', () => {
    const bridge = fakeBridge()
    const doc = fakeDocument()
    const undo = installDesktopShell({ bridge, doc })
    undo()
    doc.setTheme('light')
    expect(bridge.shell.setTheme).toHaveBeenCalledTimes(1)
    expect(bridge.wakeListeners.size).toBe(0)
  })
})
