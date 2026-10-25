import { Capacitor, registerPlugin } from '@capacitor/core'

// Zero-config iCloud sync (docs/icloud-sync.md): the iOS plugin
// (ios/App/App/ICloudPlugin.swift) and the bridge the transports use. Files
// are named by a path relative to a container's Documents/ folder; the "own"
// container holds lifeGLANCE's sync file, "dayglance" is dayGLANCE's, whose
// GLANCE/events/ carries the intents the GLANCE apps exchange. Reads answer the
// classification every file shell answers ({ kind: absent | downloading |
// error | text, text?, error? }). lastGLANCE's src/native/icloud.ts.
//
// iOS only: Android and the web have no plugin and isICloudAvailable() is false.

export const ICloud = registerPlugin('ICloud')

/** True only inside an iOS shell that registered the plugin. */
export function isICloudAvailable() {
  return Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('ICloud')
}

const badAnswer = { kind: 'error', error: 'bad answer from the shell' }

/**
 * The calls the transports make, every failure answered rather than thrown.
 * @param {object} [plugin] injectable for tests
 */
export function createICloudBridge(plugin = ICloud) {
  const errorOf = (err) => ({ kind: 'error', error: err?.message ?? String(err) })
  return {
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
  shared ??= createICloudBridge()
  return shared
}
