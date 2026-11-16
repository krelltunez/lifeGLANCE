// Direct Access on the desktop (docs/desktop-app.md; the feature is
// docs/direct-access.md): the user picks a folder that a sync tool (Syncthing,
// Dropbox, Google Drive, OneDrive, Nextcloud, a network share) keeps in step,
// and lifeGLANCE reads and writes its files there.
//
// This implements the ANDROID folder contract of src/native/directAccess.js
// (status, pickFolder, disconnect, read, write, deleteFile, and files by path),
// because a desktop can hold a real folder the way Android's SAF tree does;
// the renderer builds its bridge with createDirectAccessBridge(plugin,
// 'android'), and the settings show "Choose folder". The file rules (reads
// that never mistake a placeholder for an absent file, atomic writes, paths
// confined to the folder) are directAccessStore.ts, from dayGLANCE.
//
// After dayGLANCE's electron/directAccess.ts (krelltunez/dayGLANCE@8d72008).
// The folder is held here, in the main process: under the Mac App Store
// sandbox only a security-scoped bookmark from the native dialog survives a
// relaunch, and only the process that resolved it can use it. Elsewhere a
// plain persisted path is used. One difference: the watcher's nudge reaches
// the renderer as an event, where the phone shells have none and rely on the
// 15 s poll alone (which still runs).

import fs from 'node:fs'
import path from 'node:path'
import { createDirectAccessStore } from './directAccessStore.js'
import { writeFileAtomicSync } from './atomicWrite.js'

export function registerDirectAccessHandlers(deps) {
  const store = createDirectAccessStore()
  const configFile = () => path.join(deps.app.getPath('userData'), 'direct-access.json')
  let stopAccessing = null
  let restored = false

  const loadConfig = () => {
    try {
      const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf-8'))
      return cfg && typeof cfg.path === 'string' ? cfg : null
    } catch {
      return null
    }
  }

  // Security-scoped access for a bookmark (the MAS build); a no-op without one.
  const beginAccess = (bookmark) => {
    if (stopAccessing) { try { stopAccessing() } catch { /* ignore */ } stopAccessing = null }
    if (bookmark && typeof deps.app.startAccessingSecurityScopedResource === 'function') {
      try { stopAccessing = deps.app.startAccessingSecurityScopedResource(bookmark)  } catch { stopAccessing = null }
    }
  }

  const notifyChanged = () => deps.getWindow()?.webContents.send('direct-access:changed')

  const openFolder = (cfg) => {
    beginAccess(cfg.bookmark)
    store.setBase(cfg.path)
    store.startWatch(notifyChanged)
  }

  // The folder picked in an earlier session, re-opened on first use. It is
  // kept even when unreachable right now (a tool not started yet, an unmounted
  // share): the settings show it connected but unavailable, and reads report
  // the folder error until it returns. Only disconnect or a new pick drops it.
  const ensureRestored = () => {
    if (restored) return
    restored = true
    const cfg = loadConfig()
    if (cfg) openFolder(cfg)
  }

  const status = () => {
    ensureRestored()
    const base = store.getBase()
    return { configured: !!base, name: base ? path.basename(base) : null, path: base, reachable: store.reachable() }
  }

  // Every handler answers only the main window; anything else gets the
  // harmless empty answer of its contract.
  const handle = (channel, fallback, fn) => {
    deps.ipcMain.handle(channel, (event, ...args) => {
      if (!deps.isMainWindowSender(event.sender)) return fallback
      ensureRestored()
      return fn(...args)
    })
  }

  const relOf = (options) => {
    const rel = options?.rel
    return typeof rel === 'string' ? rel : null
  }
  const textOf = (options) => {
    const text = options?.text
    return typeof text === 'string' ? text : null
  }
  const badPath = { kind: 'error', error: 'bad path' }

  handle('direct-access:status', { configured: false, name: null, path: null, reachable: false }, () => status())

  handle('direct-access:pick-folder', { cancelled: true }, async () => {
    const options = {
      properties: ['openDirectory', 'createDirectory'],
      securityScopedBookmarks: true,
      message: 'Choose the folder lifeGLANCE should sync through',
    }
    const win = deps.getWindow()
    const result = win ? await deps.dialog.showOpenDialog(win, options) : await deps.dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
    const cfg = { path: result.filePaths[0], bookmark: result.bookmarks?.[0] }
    try {
      writeFileAtomicSync(configFile(), JSON.stringify(cfg))
    } catch (e) {
      deps.log(`direct access: could not save the folder: ${e instanceof Error ? e.message : String(e)}`)
    }
    openFolder(cfg)
    deps.log('direct access: folder picked')
    return status()
  })

  handle('direct-access:disconnect', undefined, () => {
    store.stopWatch()
    store.setBase(null)
    beginAccess(undefined)
    try { fs.unlinkSync(configFile()) } catch { /* already gone */ }
  })

  handle('direct-access:read', { kind: 'error', error: 'not allowed' }, () => store.read())
  handle('direct-access:write', { ok: false }, (options) => {
    const text = textOf(options)
    return { ok: text !== null && store.write(text) }
  })
  handle('direct-access:delete', { ok: false }, () => ({ ok: store.remove() }))

  // Files by path, confined to the folder by the store.
  handle('direct-access:list-files', { names: null }, (options) => {
    const rel = relOf(options)
    return { names: rel === null ? null : store.listFiles(rel) }
  })
  handle('direct-access:read-file', badPath, (options) => {
    const rel = relOf(options)
    return rel === null ? badPath : store.readFile(rel)
  })
  handle('direct-access:write-file', { ok: false }, (options) => {
    const rel = relOf(options)
    const text = textOf(options)
    return { ok: rel !== null && text !== null && store.writeFile(rel, text) }
  })
  handle('direct-access:delete-file', { ok: false }, (options) => {
    const rel = relOf(options)
    return { ok: rel !== null && store.deleteFile(rel) }
  })
  handle('direct-access:make-dir', { ok: false }, (options) => {
    const rel = relOf(options)
    return { ok: rel !== null && store.makeDir(rel) }
  })

  deps.app.on('will-quit', () => store.stopWatch())
}
