// The Electron desktop shell's bridge, as the page sees it (docs/desktop-app.md,
// "The bridge"). The shell's preload (electron/preload.cjs) exposes one object,
// `window.lifeGlanceDesktop`; on the web, Android and iOS there is none and
// `desktopBridge()` is null.
//
// The desktop app is not a Capacitor shell: `Capacitor.isNativePlatform()`
// stays false there (and `getPlatform()` reads 'web'), so everything gated on
// those behaves as the web build does, and each module that needs the shell
// asks `desktopBridge()` for it. lastGLANCE's src/native/desktop.ts, with the
// few groups this app has:
//
//   info    { platform: 'darwin' | 'win32' | 'linux' }
//   shell   setTheme(dark)       the app's theme, for the window's own chrome
//           log(message)         one line in the app's log file
//           onWake(listener)     the machine woke or the screen unlocked; returns the unsubscribe
//   icloud  the iOS plugin's calls (src/native/icloud.js), over the iCloud
//           Drive folders on macOS; `onChanged(listener)` is its "changed" event

/**
 * Every bridge method, as `group.method`. electron/bridgeContract.test.js
 * holds this list equal to what the preload exposes.
 */
export const DESKTOP_BRIDGE_METHODS = Object.freeze([
  'shell.setTheme',
  'shell.log',
  'shell.onWake',
  'icloud.available',
  'icloud.readFile',
  'icloud.writeFile',
  'icloud.listFiles',
  'icloud.deleteFile',
  'icloud.makeDir',
  'icloud.onChanged',
])

const PLATFORMS = ['darwin', 'win32', 'linux']

function isDesktopBridge(value) {
  return !!value && typeof value === 'object'
    && PLATFORMS.includes(value.info?.platform)
    && typeof value.shell?.setTheme === 'function'
}

/** The desktop shell's bridge, or null anywhere else (web, PWA, Android, iOS). */
export function desktopBridge() {
  if (typeof window === 'undefined') return null
  const candidate = window.lifeGlanceDesktop
  return isDesktopBridge(candidate) ? candidate : null
}

export function isDesktop() {
  return desktopBridge() !== null
}

/** A line in the desktop app's log file; a no-op anywhere else. Never throws. */
export function desktopLog(message) {
  try { desktopBridge()?.shell.log?.(String(message)) } catch { /* best-effort */ }
}

/**
 * Wire the page to the shell, once, before first paint:
 *
 *  - `html.desktop` and `html.desktop-<platform>`, for CSS that is the desktop
 *    app's own;
 *  - the theme, now and on every change, so the window's title bar matches and
 *    the next launch paints the right color before the page loads;
 *  - the wake signal. The page's foreground work hangs off `visibilitychange`
 *    (a sync on return, the wake lock), and a window left up across a sleep or
 *    a screen lock never sends one, so the shell's signal replays it. Each
 *    listener still reads `visibilityState` itself.
 *
 * A no-op (returning a no-op) where there is no shell.
 *
 * @param {object} [deps] injectable for tests
 * @returns {() => void} undo
 */
export function installDesktopShell({ bridge = desktopBridge(), doc = typeof document === 'undefined' ? null : document } = {}) {
  if (!bridge || !doc) return () => {}
  const root = doc.documentElement
  root.classList.add('desktop', `desktop-${bridge.info.platform}`)

  const reportTheme = () => {
    try { bridge.shell.setTheme(root.getAttribute('data-theme') !== 'light') } catch { /* an older shell */ }
  }
  reportTheme()
  const Observer = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver
  const observer = Observer ? new Observer(reportTheme) : null
  observer?.observe(root, { attributes: true, attributeFilter: ['data-theme'] })

  let stopWake = null
  try { stopWake = bridge.shell.onWake(() => { doc.dispatchEvent(new Event('visibilitychange')) }) } catch { /* an older shell */ }

  return () => {
    observer?.disconnect()
    stopWake?.()
  }
}
