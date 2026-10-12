import { Capacitor, registerPlugin } from '@capacitor/core'

// Direct Access sync (docs/direct-access.md): the native folder plugin, and
// the bridge shape the shared file transport consumes.
//
// Both shells implement the same plugin (DirectAccessPlugin.kt, .swift) with
// one difference that the bridge carries rather than hides: Android holds a
// FOLDER (a SAF tree) and offers files by path below it; iOS holds FILES (a
// bookmark each for the snapshot, the shared roster and the intents event
// set), because the Files providers cannot hand an app a folder. The bridge
// an app-level transport receives is therefore the same shape dayGLANCE's
// shells produce (its src/sync/directAccessNativeBridge.js) and lastGLANCE's
// src/native/directAccess.ts hands on, so the transport and the cycle are
// shared code:
//
//   restore / status            → { configured, name, path, reachable }
//   pick()                      → the status, null when cancelled, { error } when refused
//   pickFile(slot) / createFile(slot)   iOS only (the snapshot, 'users' or 'events')
//   disconnect / read / write / deleteFile
//   paths.{list, read, write, remove, makeDir}   Android only, paths confined to the folder
//   users.{status, read, write, forget}          iOS only
//   events.{status, read, write, forget}         iOS only
//
// Web/PWA has no folder access a page could hold across sessions: the plugin
// is absent there and isDirectAccessAvailable() is false.
//
// Ported from lastGLANCE (src/native/directAccess.ts); keep the two in sync
// when fixing bugs in either.

export const DirectAccess = registerPlugin('DirectAccess')

// Capability gate, not platform gate (the same probe secureStore.js and
// vaultSse.js use): true only inside a shell that registered the plugin. An
// older shell, and the web, answer false.
export function isDirectAccessAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('DirectAccess')
}

/** A plugin rejection becomes the `{ error, path? }` the transport shows on its card; a dismissal becomes null. */
async function pickResult(run) {
  let r
  try {
    r = await run()
  } catch (err) {
    const path = err?.data?.path
    return { error: err?.message ?? String(err), ...(path ? { path } : {}) }
  }
  if (!r || r.cancelled) return null
  return r
}

const badAnswer = { kind: 'error', error: 'bad answer from the shell' }
const readOf = async (run) => {
  const r = await run()
  return r && typeof r.kind === 'string' ? r : badAnswer
}
const okOf = async (run) => (await run())?.ok === true

/**
 * The bridge for the running shell. `platform` and `plugin` are injectable for
 * tests; by default the plugin is the registered one and the platform the
 * real one.
 */
export function createDirectAccessBridge(
  plugin = DirectAccess,
  platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
) {
  const slot = (status, read, write, forget) => ({
    status,
    read: () => readOf(read),
    write: (text) => okOf(() => write({ text })),
    forget: async () => { try { await forget(); return true } catch { return false } },
  })
  return {
    restore: () => plugin.status(),
    status: () => plugin.status(),
    pick: () => pickResult(() => (platform === 'ios' ? plugin.pickFile({ slot: 'snapshot' }) : plugin.pickFolder())),
    pickFile: (s = 'snapshot') => pickResult(() => plugin.pickFile({ slot: s })),
    createFile: (s = 'snapshot') => pickResult(() => plugin.createFile({ slot: s })),
    disconnect: async () => { try { await plugin.disconnect(); return true } catch { return false } },
    read: () => readOf(() => plugin.read()),
    write: (text) => okOf(() => plugin.write({ text })),
    deleteFile: () => okOf(() => plugin.deleteFile()),
    ...(platform === 'android'
      ? {
          paths: {
            list: async (rel) => { const r = await plugin.listFiles({ rel }); return Array.isArray(r?.names) ? r.names : null },
            read: (rel) => readOf(() => plugin.readFile({ rel })),
            write: (rel, text) => okOf(() => plugin.writeFile({ rel, text })),
            remove: (rel) => okOf(() => plugin.deleteFileAt({ rel })),
            makeDir: (rel) => okOf(() => plugin.makeDir({ rel })),
          },
        }
      : {
          users: slot(() => plugin.usersStatus(), () => plugin.readUsers(), (o) => plugin.writeUsers(o), () => plugin.forgetUsers()),
          events: slot(() => plugin.eventsStatus(), () => plugin.readEvents(), (o) => plugin.writeEvents(o), () => plugin.forgetEvents()),
        }),
  }
}
