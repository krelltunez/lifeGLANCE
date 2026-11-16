import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopBridge, desktopLog, installDesktopShell, isDesktop, menuLabels, syncDesktopMenuLabels } from './desktop.js'

// The page's side of the desktop bridge: found only inside the shell, and wired
// up once at boot. A minimal document stands in for the real one (the suite
// runs in Node).

function fakeBridge(platform = 'darwin') {
  const wakeListeners = new Set()
  const fullscreenListeners = new Set()
  return {
    info: { platform },
    shell: {
      setTheme: vi.fn(),
      setMenuLabels: vi.fn(),
      log: vi.fn(),
      onWake: vi.fn((listener) => { wakeListeners.add(listener); return () => wakeListeners.delete(listener) }),
      onFullscreen: vi.fn((listener) => { fullscreenListeners.add(listener); return () => fullscreenListeners.delete(listener) }),
    },
    wake: (why) => { for (const l of wakeListeners) l(why) },
    fullscreen: (on) => { for (const l of fullscreenListeners) l(on) },
    wakeListeners,
    fullscreenListeners,
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
      classList: {
        add: (...names) => names.forEach((n) => classes.add(n)),
        toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name) },
      },
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

  it('marks native fullscreen, where macOS hides the traffic lights and the title strip goes', () => {
    const bridge = fakeBridge('darwin')
    const doc = fakeDocument()
    installDesktopShell({ bridge, doc })
    bridge.fullscreen(true)
    expect(doc.classes.has('desktop-fullscreen')).toBe(true)
    bridge.fullscreen(false)
    expect(doc.classes.has('desktop-fullscreen')).toBe(false)
    bridge.fullscreen('yes')                                   // only a real true counts
    expect(doc.classes.has('desktop-fullscreen')).toBe(false)
  })

  it('still wires up a shell that predates a signal', () => {
    const bridge = fakeBridge()
    delete bridge.shell.onFullscreen
    const doc = fakeDocument()
    expect(() => installDesktopShell({ bridge, doc })).not.toThrow()
    bridge.wake('resume')
    expect(doc.events).toEqual(['visibilitychange'])
  })

  it('undoes its listeners', () => {
    const bridge = fakeBridge()
    const doc = fakeDocument()
    const undo = installDesktopShell({ bridge, doc })
    undo()
    doc.setTheme('light')
    expect(bridge.shell.setTheme).toHaveBeenCalledTimes(1)
    expect(bridge.wakeListeners.size).toBe(0)
    expect(bridge.fullscreenListeners.size).toBe(0)
  })
})

// The application menu's strings come from the page (desktop.json, `menu`).
describe('the menu labels', () => {
  function fakeI18n(menu, isInitialized = true) {
    const handlers = {}
    return {
      isInitialized,
      t: vi.fn((key, options) => (key === 'desktop:menu' && options?.returnObjects ? menu.current : key)),
      on: (event, cb) => { (handlers[event] ??= []).push(cb) },
      emit: (event) => { for (const cb of handlers[event] ?? []) cb() },
    }
  }

  it('are the current language\'s menu block, or nothing before it has loaded', () => {
    expect(menuLabels(fakeI18n({ current: { file: 'Datei', edit: 'Bearbeiten' } }))).toEqual({ file: 'Datei', edit: 'Bearbeiten' })
    // i18next answers the key itself for a namespace it has not loaded.
    expect(menuLabels(fakeI18n({ current: 'desktop:menu' }))).toBeNull()
    expect(menuLabels(fakeI18n({ current: {} }))).toBeNull()
    expect(menuLabels(fakeI18n({ current: { file: 'Datei', edit: { nested: true } } }))).toBeNull()
    expect(menuLabels(fakeI18n({ current: ['File'] }))).toBeNull()
  })

  it('reach the shell at once, and again when the language changes', () => {
    const bridge = fakeBridge()
    const menu = { current: { file: 'File' } }
    const i18n = fakeI18n(menu)
    syncDesktopMenuLabels(i18n, bridge)
    expect(bridge.shell.setMenuLabels.mock.calls).toEqual([[{ file: 'File' }]])
    menu.current = { file: 'Datei' }
    i18n.emit('languageChanged')
    expect(bridge.shell.setMenuLabels).toHaveBeenLastCalledWith({ file: 'Datei' })
  })

  it('wait for the strings when the language is not loaded yet', () => {
    const bridge = fakeBridge()
    const menu = { current: 'desktop:menu' }
    const i18n = fakeI18n(menu, false)
    syncDesktopMenuLabels(i18n, bridge)
    expect(bridge.shell.setMenuLabels).not.toHaveBeenCalled()
    menu.current = { file: 'Fichier' }
    i18n.emit('loaded')
    expect(bridge.shell.setMenuLabels).toHaveBeenCalledWith({ file: 'Fichier' })
  })

  it('are nobody\'s business off the desktop', () => {
    const i18n = fakeI18n({ current: { file: 'File' } })
    expect(() => syncDesktopMenuLabels(i18n, null)).not.toThrow()
    expect(i18n.t).not.toHaveBeenCalled()
  })
})
