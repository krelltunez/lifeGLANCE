// The lifeGLANCE desktop shell: the main process. Design: docs/desktop-app.md.
//
// The web bundle in an Electron window on macOS, Windows and Linux, after
// lastGLANCE's desktop app (krelltunez/lastGLANCE, electron/main.ts) and much
// smaller than it: one window, no tray, no background mode, no local servers.
// What it adds to the web app is iCloud Drive sync on macOS (icloud.js).
//
// Plain ES modules run as they are: there is no compile step for this folder.

import { app, BrowserWindow, ipcMain, Menu, nativeTheme, powerMonitor, protocol, screen, session, shell } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { APP_BASE_URL, APP_HOST, APP_SCHEME, resolveAppRequest } from './appProtocol.js'
import { buildApplicationMenuTemplate } from './applicationMenu.js'
import { contentSecurityPolicy, inlineScriptHashes } from './csp.js'
import { isAllowedExternalUrl } from './externalLinks.js'
import { createICloudStore, NO_ICLOUD } from './icloud.js'
import { decideRecovery } from './rendererRecovery.js'
import { initStartupLog, logStartup } from './startupLog.js'
import { loadWindowState, onScreen, savedThemeIsDark, saveWindowState, saveWindowTheme, windowBackgroundColor } from './windowState.js'

// The app:// scheme as a real web origin, before ready (a no-op after it).
// standard+secure gives app://lifeglance a stable origin and a secure context
// (IndexedDB, crypto.subtle); fetch support lets the page load its own chunks.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

// One name and one userData folder for every build. Electron derives the
// default from package.json's lowercase `name`, and a later Mac App Store
// bundle id must not move it either. Chromium's own --user-data-dir switch
// still wins, as in any Chromium app: it is how the smoke test runs on a
// profile of its own.
app.setName('lifeGLANCE')
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'lifeGLANCE'))
}

initStartupLog(app.getPath('userData'))
logStartup(`main process module loaded, version ${app.getVersion()}`)
process.on('uncaughtException', (err) => {
  logStartup(`uncaughtException: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
})
process.on('unhandledRejection', (reason) => {
  logStartup(`unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`)
})

const DEV = !app.isPackaged
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5184'
const APP_DIST_DIR = path.join(import.meta.dirname, '../dist')
const IS_MAC = process.platform === 'darwin'

let mainWindow = null
let isQuitting = false
let mainRecoveryAttempts = []

// Null for a destroyed window, so callers need no isDestroyed() checks.
function live(win) {
  return win && !win.isDestroyed() ? win : null
}

function isMainWindowSender(sender) {
  return sender === live(mainWindow)?.webContents
}

function openExternalSafe(url) {
  if (isAllowedExternalUrl(url)) void shell.openExternal(url)
  else logStartup('external link refused')
}

// The app itself: the Vite dev server in dev, app://lifeglance when packaged.
// Everything else is an external navigation.
function isSameAppOrigin(url) {
  try {
    const parsed = new URL(url)
    if (DEV && parsed.origin === new URL(VITE_DEV_SERVER_URL).origin) return true
    return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST
  } catch {
    return false
  }
}

// ── The page's calls (preload.cjs; the renderer's side is src/native/desktop.js) ──

// The app's theme is its own setting, not the OS's: follow it for the window's
// pre-paint color on the next launch, and for the title bar and menus now.
function applyTheme(dark) {
  nativeTheme.themeSource = dark ? 'dark' : 'light'
  live(mainWindow)?.setBackgroundColor(windowBackgroundColor(app.getPath('userData')))
}

ipcMain.on('shell:set-theme', (event, dark) => {
  if (!isMainWindowSender(event.sender) || typeof dark !== 'boolean') return
  saveWindowTheme(app.getPath('userData'), dark)
  applyTheme(dark)
})

// The page's lines for the log file (src/native/desktop.js, desktopLog), so a
// report from a real machine can be traced: packaged builds have no DevTools.
// Capped per session; a line is cut at 500 characters.
const RENDERER_LOG_LINES_PER_SESSION = 500
let rendererLogLines = 0
ipcMain.on('shell:log', (event, message) => {
  if (!isMainWindowSender(event.sender) || typeof message !== 'string') return
  if (rendererLogLines >= RENDERER_LOG_LINES_PER_SESSION) return
  rendererLogLines += 1
  logStartup(`page: ${message.replace(/\s+/g, ' ').slice(0, 500)}${rendererLogLines === RENDERER_LOG_LINES_PER_SESSION ? ' (page log limit reached for this session)' : ''}`)
})

// The page's foreground work (a sync on return, the wake lock) hangs off
// `visibilitychange`, which a window left up across a sleep or a screen lock
// never sends: tell it the machine woke.
function sendWake(why) {
  live(mainWindow)?.webContents.send('shell:wake', why)
}

// ── iCloud Drive (docs/desktop-app.md, "iCloud Drive on macOS") ─────────────
// macOS only: the containers live under ~/Library/Mobile Documents, which no
// other platform has. Elsewhere every call answers "iCloud not available".
const brctlAskedAt = new Map()
const icloud = IS_MAC
  ? createICloudStore({
      home: app.getPath('home'),
      // Ask the iCloud daemon to fetch a cloud-only file, at most once a minute
      // per file. Best-effort, and never under the Mac App Store sandbox, which
      // would not let brctl reach the container.
      requestDownload: process.mas ? undefined : (abs) => {
        const last = brctlAskedAt.get(abs) ?? 0
        if (Date.now() - last < 60_000) return
        brctlAskedAt.set(abs, Date.now())
        execFile('/usr/bin/brctl', ['download', abs], () => { /* best-effort */ })
      },
    })
  : null

const icloudArgs = (options) => (options && typeof options === 'object' ? options : {})
ipcMain.handle('icloud:available', (event) => (isMainWindowSender(event.sender) && icloud ? icloud.available() : { available: false }))
ipcMain.handle('icloud:read-file', (event, options) => {
  if (!isMainWindowSender(event.sender) || !icloud) return { kind: 'error', error: NO_ICLOUD }
  const { path: rel, container } = icloudArgs(options)
  return icloud.readFile(rel, container)
})
ipcMain.handle('icloud:write-file', (event, options) => {
  if (!isMainWindowSender(event.sender) || !icloud) return { ok: false, error: NO_ICLOUD }
  const { path: rel, container, text } = icloudArgs(options)
  return icloud.writeFile(rel, text, container)
})
ipcMain.handle('icloud:list-files', (event, options) => {
  if (!isMainWindowSender(event.sender) || !icloud) return { names: null }
  const { path: rel, container } = icloudArgs(options)
  return icloud.listFiles(rel, container)
})
ipcMain.handle('icloud:delete-file', (event, options) => {
  if (!isMainWindowSender(event.sender) || !icloud) return { ok: false, error: NO_ICLOUD }
  const { path: rel, container } = icloudArgs(options)
  return icloud.deleteFile(rel, container)
})
ipcMain.handle('icloud:make-dir', (event, options) => {
  if (!isMainWindowSender(event.sender) || !icloud) return { ok: false, error: NO_ICLOUD }
  const { path: rel, container } = icloudArgs(options)
  return icloud.makeDir(rel, container)
})

// ── The window ───────────────────────────────────────────────────────────────

function createWindow() {
  const userData = app.getPath('userData')
  const saved = onScreen(loadWindowState(userData), screen.getAllDisplays().map((d) => d.workArea))
  logStartup('createWindow: called')

  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x != null && saved.y != null ? { x: saved.x, y: saved.y } : {}),
    show: false,
    backgroundColor: windowBackgroundColor(userData),
    // The app has a phone layout, so a narrow window is a real layout, not a
    // broken one.
    minWidth: 360,
    minHeight: 520,
    title: 'lifeGLANCE',
    // Windows and Linux: the menu bar stays out of the timeline's way until
    // Alt asks for it. Its shortcuts work either way.
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: DEV,
    },
  })
  mainWindow = win

  // The last non-maximized bounds, so a maximized window restores correctly.
  let normalBounds = { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
  const trackBounds = () => {
    if (live(win) && !win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) normalBounds = win.getBounds()
  }
  win.on('resize', trackBounds)
  win.on('move', trackBounds)
  win.on('close', () => {
    saveWindowState(userData, { ...normalBounds, maximized: win.isMaximized() })
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  if (saved.maximized) win.maximize()

  // Show after the first paint (no blank frame), with a fallback so a renderer
  // that never paints still leaves a visible, reportable window.
  const SHOW_FALLBACK_MS = 10_000
  let shown = false
  const showOnce = (why) => {
    if (shown) return
    shown = true
    logStartup(`main window show (${why})`)
    live(win)?.show()
  }
  const fallbackShow = setTimeout(() => showOnce('fallback-timeout'), SHOW_FALLBACK_MS)
  win.once('ready-to-show', () => { clearTimeout(fallbackShow); showOnce('ready-to-show') })
  win.once('closed', () => clearTimeout(fallbackShow))

  win.webContents.on('did-finish-load', () => logStartup('main window did-finish-load'))
  win.webContents.on('did-fail-load', (_e, code, desc, url) => logStartup(`did-fail-load: code=${code} "${desc}" url=${url}`))
  win.webContents.on('preload-error', (_e, preloadPath, err) => logStartup(`preload-error: ${preloadPath}: ${err?.message ?? err}`))

  // Crash recovery: reload, then recreate, then stop (rendererRecovery.js).
  win.webContents.on('render-process-gone', (_e, details) => {
    logStartup(`render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`)
    const decision = decideRecovery({ reason: details.reason, isQuitting, attempts: mainRecoveryAttempts, now: Date.now() })
    mainRecoveryAttempts = decision.attempts
    if (decision.action === 'ignore' || decision.action === 'give-up') {
      if (decision.action === 'give-up') logStartup('crash recovery: giving up (crash loop)')
      return
    }
    // Deferred so a crash a moment before quit sees the flag before-quit sets.
    setTimeout(() => {
      if (isQuitting || live(mainWindow) !== win) return
      logStartup(`crash recovery: ${decision.action}`)
      if (decision.action === 'reload') win.webContents.reload()
      else if (decision.action === 'load-url') load(win)
      else {
        // The new window first: with none left, window-all-closed would quit.
        createWindow()
        win.destroy()
      }
    }, 250)
  })

  // Links leave the app for the system browser or mail client; the renderer
  // never opens a second window and never navigates off its own origin.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isSameAppOrigin(url)) return
    event.preventDefault()
    openExternalSafe(url)
  })

  if (DEV) {
    // The dev server may be restarting; keep retrying a refused dev load.
    // ERR_ABORTED (-3) is a superseded navigation.
    win.webContents.on('did-fail-load', (_e, code, _desc, url) => {
      if (code === -3 || !url?.startsWith(VITE_DEV_SERVER_URL)) return
      setTimeout(() => { if (live(win)) load(win) }, 1000)
    })
  }
  load(win)
  return win
}

// A failed load is reported by did-fail-load (logged, and retried in dev), so
// the promise's own rejection has nothing to add.
function load(win) {
  win.loadURL(DEV ? VITE_DEV_SERVER_URL : APP_BASE_URL).catch(() => {})
}

function showMainWindow() {
  const w = live(mainWindow)
  if (!w) { createWindow(); return }
  if (w.isMinimized()) w.restore()
  if (!w.isVisible()) w.show()
  w.focus()
}

// One process at a time: two would be two writers on one IndexedDB and two
// sync loops. A second launch focuses the first.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => { if (app.isReady()) showMainWindow() })
}

// Windows: the identity notifications and the taskbar group the app under.
if (process.platform === 'win32') app.setAppUserModelId('com.lifeglance.app')

app.setAboutPanelOptions({
  applicationName: 'lifeGLANCE',
  applicationVersion: app.getVersion(),
  copyright: 'Copyright © 2026 GLANCE Apps',
  website: 'https://www.glance-apps.com/apps/lifeglance',
})

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return
  logStartup('app ready')

  // The theme the page reported last time, before the window exists.
  nativeTheme.themeSource = savedThemeIsDark(app.getPath('userData')) ? 'dark' : 'light'

  Menu.setApplicationMenu(Menu.buildFromTemplate(
    buildApplicationMenuTemplate({ platform: process.platform, devTools: DEV, openExternal: openExternalSafe }),
  ))

  // What the page may ask the browser engine for: fullscreen and the screen
  // wake lock (watch mode), clipboard writes, and storage that is not evicted
  // (the timeline lives in IndexedDB). Nothing else is granted: no camera,
  // microphone, location or notifications.
  const GRANTED = new Set(['fullscreen', 'screen-wake-lock', 'clipboard-sanitized-write', 'persistent-storage'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(GRANTED.has(permission)))

  // app://lifeglance/... -> dist/ (appProtocol.js). The document carries the
  // CSP: custom-scheme responses do not pass through onHeadersReceived. The
  // Vite dev server's document gets none: the policy would block its
  // react-refresh preamble and HMR socket.
  let csp = null
  const isFile = (p) => { try { return fs.statSync(p).isFile() } catch { return false } }
  const plain = (status) => new Response(status === 403 ? 'Forbidden' : 'Not found', {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
  protocol.handle(APP_SCHEME, async (request) => {
    const resolved = resolveAppRequest(APP_DIST_DIR, request.url, isFile)
    if (resolved.status !== 200) return plain(resolved.status)
    try {
      const data = await fs.promises.readFile(resolved.filePath)
      const headers = { 'Content-Type': resolved.contentType }
      if (resolved.contentType.startsWith('text/html')) {
        csp ??= contentSecurityPolicy({ scriptHashes: inlineScriptHashes(data.toString('utf-8')) })
        headers['Content-Security-Policy'] = csp
      }
      return new Response(data, { status: 200, headers })
    } catch {
      return plain(404)
    }
  })

  createWindow()

  // A woken machine or an unlocked screen: the page's foreground kicks.
  powerMonitor.on('resume', () => sendWake('resume'))
  powerMonitor.on('unlock-screen', () => sendWake('unlock'))

  // The sync file changed in iCloud: run a cycle now rather than at the next poll.
  if (icloud) {
    const stopICloudWatch = icloud.watch(() => live(mainWindow)?.webContents.send('icloud:changed'))
    app.on('will-quit', stopICloudWatch)
  }

  // macOS: the app stays in the Dock with its window closed; a click reopens it.
  app.on('activate', () => showMainWindow())
})

app.on('before-quit', () => {
  isQuitting = true
})

// Closing the window quits, except on macOS, where apps stay in the Dock. The
// app has nothing to do without its window: no reminders, no tray.
app.on('window-all-closed', () => {
  if (IS_MAC) return
  logStartup('window-all-closed: quit')
  app.quit()
})
