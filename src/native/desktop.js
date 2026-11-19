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
//   info         { platform: 'darwin' | 'win32' | 'linux', version, isMAS, secureStorage }
//   shell        setTheme(dark)         the app's theme, for the window's own chrome
//                setMenuLabels(labels)  the application menu's strings (desktop.json, `menu`)
//                log(message)           one line in the app's log file
//                latestRelease()        a newer release this OS can install ({ version, url }), or null
//                onWake(listener)       the machine woke or the screen unlocked
//                onFullscreen(listener) the window entered or left native fullscreen (true/false)
//   http         the page's requests, made by the main process with no CORS
//                (electron/httpProxy.js): request(method, url, headers, body, options)
//                answers { status, statusText, body, headers } or { error };
//                inspect / grant / grants / revoke are the private-address
//                permission (src/sync/privateAddress.js)
//   vaultSse     GLANCEvault's real-time push, read by the main process: the
//                VaultSse plugin's start / stop, and onMessage for its event
//   secureStore  the SecureStore plugin's get / set / delete, over the OS keychain
//   directAccess the Android folder contract of src/native/directAccess.js,
//                plus onChanged from the folder watcher
//   icloud       the iOS plugin's calls (src/native/icloud.js), over the iCloud
//                Drive folders on macOS; onChanged is its "changed" event
//   billing      @glance-apps/billing's ElectronBillingApi, which
//                createElectronRendererAdapter drives (src/billing/billing.js):
//                the App Store's purchases, answered on the Mac App Store
//                build only
//
// Every `on…` method returns its unsubscribe function.

/**
 * Every bridge method, as `group.method`. electron/bridgeContract.test.js
 * holds this list equal to what the preload exposes.
 */
export const DESKTOP_BRIDGE_METHODS = Object.freeze([
  'shell.setTheme',
  'shell.setMenuLabels',
  'shell.log',
  'shell.latestRelease',
  'shell.onWake',
  'shell.onFullscreen',
  'http.request',
  'http.inspect',
  'http.grant',
  'http.grants',
  'http.revoke',
  'vaultSse.start',
  'vaultSse.stop',
  'vaultSse.onMessage',
  'secureStore.get',
  'secureStore.set',
  'secureStore.delete',
  'directAccess.status',
  'directAccess.pickFolder',
  'directAccess.disconnect',
  'directAccess.read',
  'directAccess.write',
  'directAccess.deleteFile',
  'directAccess.listFiles',
  'directAccess.readFile',
  'directAccess.writeFile',
  'directAccess.deleteFileAt',
  'directAccess.makeDir',
  'directAccess.onChanged',
  'icloud.available',
  'icloud.readFile',
  'icloud.writeFile',
  'icloud.listFiles',
  'icloud.deleteFile',
  'icloud.makeDir',
  'icloud.onChanged',
  'billing.subscriptionStatus',
  'billing.subscriptionPurchase',
  'billing.subscriptionRestore',
  'billing.subscriptionPrices',
  'billing.onSubscriptionEvent',
  'billing.onSubscriptionPricesReady',
])

/** The facts the preload exposes under `info`. */
export const DESKTOP_INFO_FIELDS = Object.freeze(['platform', 'version', 'isMAS', 'secureStorage'])

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
 *    app's own (the macOS title strip, src/index.css);
 *  - `html.desktop-fullscreen` while the window is in native fullscreen, where
 *    macOS hides the traffic lights and the strip has nothing to hold;
 *  - the theme, now and on every change, so the window's chrome matches and
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

  const stops = []
  const listen = (subscribe) => { try { stops.push(subscribe()) } catch { /* an older shell */ } }
  listen(() => bridge.shell.onWake(() => { doc.dispatchEvent(new Event('visibilitychange')) }))
  listen(() => bridge.shell.onFullscreen((on) => { root.classList.toggle('desktop-fullscreen', on === true) }))

  return () => {
    observer?.disconnect()
    for (const stop of stops) stop?.()
  }
}

/** The current language's application-menu strings (desktop.json, `menu`), or null before they have loaded. */
export function menuLabels(i18n) {
  const labels = i18n.t('desktop:menu', { returnObjects: true })
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return null
  const entries = Object.entries(labels)
  if (entries.length === 0 || entries.some(([, v]) => typeof v !== 'string')) return null
  return Object.fromEntries(entries)
}

/**
 * The application menu speaks the app's language: push its strings now (if
 * loaded) and again on every language change. The shell keeps an English menu
 * until a complete set arrives (electron/applicationMenu.js).
 */
export function syncDesktopMenuLabels(i18n, bridge = desktopBridge()) {
  if (!bridge) return
  const push = () => {
    const labels = menuLabels(i18n)
    try { if (labels) bridge.shell.setMenuLabels(labels) } catch { /* an older shell */ }
  }
  i18n.on('initialized', push)
  i18n.on('languageChanged', push)
  i18n.on('loaded', push)
  if (i18n.isInitialized) push()
}
