// Shared WebDAV URL/config helpers for the cloud-sync and auto-backup panels.
//
// Both the Cloud Sync "test connection" and the Auto-Backup "test connection"
// must build the connection the SAME way. Previously the sync Test pre-resolved
// the provider base (adding Nextcloud's /remote.php/dav/files/<user> path) while
// the auto-backup Test passed the raw url + provider straight through — so the
// same server could pass one test and fail the other (issue #206). These helpers
// are the single source of truth used by both.

/**
 * Resolve the WebDAV base URL for a provider. Nextcloud exposes files under
 * /remote.php/dav/files/<username>; every other provider (Koofr, generic WebDAV,
 * Synology, fnOS, …) uses the URL exactly as entered.
 */
export function resolveWebdavBase(provider, url, username) {
  const base = (url || '').replace(/\/+$/, '')
  if (provider === 'nextcloud' && !base.includes('/remote.php/dav')) {
    return `${base}/remote.php/dav/files/${encodeURIComponent(username)}`
  }
  return base
}

/**
 * Build the connection config the sync engine's test/save expects, with the
 * provider-resolved WebDAV base. Mirrors exactly what CloudSyncModal's sync Test
 * builds, so the auto-backup Test exercises the identical endpoint.
 */
export function buildWebdavConfig({ provider, url, username, password, folder }) {
  return {
    provider,
    url,
    username,
    password,
    folder,
    enabled: true,
    webdavUrl: resolveWebdavBase(provider, url, username),
    nextcloudUrl: url,
    appPassword: password,
  }
}
