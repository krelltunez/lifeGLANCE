import { Capacitor, registerPlugin } from '@capacitor/core'
import { desktopBridge } from './desktop.js'

// Zero-config iCloud sync (docs/icloud-sync.md): the iOS plugin
// (ios/App/App/ICloudPlugin.swift) and the bridge the transports use. Files
// are named by a path relative to a container's Documents/ folder; the "own"
// container holds lifeGLANCE's sync file, "dayglance" is dayGLANCE's, whose
// GLANCE/events/ carries the intents the GLANCE apps exchange. Reads answer the
// classification every file shell answers ({ kind: absent | downloading |
// error | text, text?, error? }). lastGLANCE's src/native/icloud.ts.
//
// iOS, and the desktop app on macOS (electron/icloud.js: the same calls over
// the iCloud Drive folders, docs/desktop-app.md). Android, the web and the
// desktop app elsewhere have none, and isICloudAvailable() is false.

export const ICloud = registerPlugin('ICloud')

/** The desktop app's iCloud group, on macOS only. */
function desktopICloud() {
  const desktop = desktopBridge()
  return desktop?.info.platform === 'darwin' && desktop.icloud ? desktop.icloud : null
}

/** True inside an iOS shell that registered the plugin, or the desktop app on macOS. */
export function isICloudAvailable() {
  return (Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('ICloud')) || desktopICloud() !== null
}

/** The desktop's iCloud as the plugin: the same calls, its change event as addListener. */
export function desktopICloudPlugin(desktop) {
  return {
    available: () => desktop.available(),
    readFile: (o) => desktop.readFile(o),
    writeFile: (o) => desktop.writeFile(o),
    listFiles: (o) => desktop.listFiles(o),
    deleteFile: (o) => desktop.deleteFile(o),
    makeDir: (o) => desktop.makeDir(o),
    addListener: async (_event, cb) => {
      const unsubscribe = desktop.onChanged(() => cb())
      return { remove: async () => { unsubscribe() } }
    },
  }
}

const badAnswer = { kind: 'error', error: 'bad answer from the shell' }

/**
 * The calls the transports make, every failure answered rather than thrown.
 * @param {object} [plugin] injectable for tests
 * @param {object} [options]
 * @param {boolean} [options.absentMayBePending] A missing file may be one
 *   iCloud has not listed on this device yet: the desktop app reads the iCloud
 *   Drive folder as plain files. iOS's API lists a file before its bytes
 *   arrive, so there a missing file is missing.
 */
export function createICloudBridge(plugin = ICloud, { absentMayBePending = false } = {}) {
  const errorOf = (err) => ({ kind: 'error', error: err?.message ?? String(err) })
  return {
    absentMayBePending,
    available: async () => { try { return (await plugin.available())?.available === true } catch { return false } },
    read: async (path, { container = 'own', allowStale = false } = {}) => {
      try {
        const r = await plugin.readFile({ path, container, allowStale })
        return r && typeof r.kind === 'string' ? r : badAnswer
      } catch (err) { return errorOf(err) }
    },
    write: async (path, text, { container = 'own', atomic = false } = {}) => {
      try { return (await plugin.writeFile({ path, text, container, atomic }))?.ok === true } catch { return false }
    },
    list: async (path, container = 'own') => {
      try { const r = await plugin.listFiles({ path, container }); return Array.isArray(r?.names) ? r.names : null } catch { return null }
    },
    remove: async (path, container = 'own') => {
      try { return (await plugin.deleteFile({ path, container }))?.ok === true } catch { return false }
    },
    makeDir: async (path, container = 'own') => {
      try { return (await plugin.makeDir({ path, container }))?.ok === true } catch { return false }
    },
    onChanged: (cb) => {
      let handle = null
      let removed = false
      Promise.resolve(plugin.addListener('changed', cb))
        .then((h) => { if (removed) void h?.remove?.(); else handle = h })
        .catch(() => {})
      return () => { removed = true; void handle?.remove?.() }
    },
  }
}

let shared = null
/** The app's bridge, or null where there is no iCloud plugin. */
export function icloudBridge() {
  if (!isICloudAvailable()) return null
  if (!shared) {
    const desktop = desktopICloud()
    shared = desktop
      ? createICloudBridge(desktopICloudPlugin(desktop), { absentMayBePending: true })
      : createICloudBridge()
  }
  return shared
}
