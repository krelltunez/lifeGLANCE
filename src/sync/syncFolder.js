// The sync folder is joined into every WebDAV URL by @glance-apps/sync as
// `${base}/${folder}/${file}` without normalizing it, so a folder typed as
// "/webdav/GLANCE/lifeglance" sent requests to
// "https://host//webdav/GLANCE/lifeglance/lifeglance-sync.json", and servers
// that don't resolve the doubled slash 404 every request (reported against
// dayGLANCE, krelltunez/dayGLANCE#2037). An empty folder did the same at the
// root, since the engine took it with `??`.

export const DEFAULT_SYNC_FOLDER = 'GLANCE/lifeglance'

/**
 * Strip leading/trailing slashes and empty or "." segments from a sync folder.
 * Backslashes count as separators, for paths pasted from Windows. Falls back to
 * the default when nothing is left.
 * @param {unknown} raw
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeSyncFolder(raw, fallback = DEFAULT_SYNC_FOLDER) {
  if (typeof raw !== 'string') return fallback
  const parts = raw.split(/[/\\]+/).map(p => p.trim()).filter(p => p && p !== '.')
  return parts.length ? parts.join('/') : fallback
}
