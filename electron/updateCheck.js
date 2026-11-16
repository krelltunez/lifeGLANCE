// The "update available" notice (docs/desktop-app.md, "Updates"; after
// dayGLANCE's versionCheck.js, by way of lastGLANCE's). There is no auto-update: the
// page asks every few hours, main reads the repository's latest GitHub release,
// and the page shows a notice linking to it. Never on the Mac App Store build,
// where the App Store updates the app.
//
// A release is reported only when it is newer and carries a download for this
// operating system, so an Android-only release never sends a desktop user to a
// page with nothing for them.

export const RELEASES_API = 'https://api.github.com/repos/krelltunez/lifeGLANCE/releases/latest'
export const CHECK_CACHE_MS = 60 * 60 * 1000

const DOWNLOADS = {
  darwin: /\.(dmg|zip)$/i,
  win32: /\.exe$/i,
  linux: /\.(AppImage|deb)$/i,
}

/** Positive when `b` is newer than `a`. Pre-release suffixes are ignored, as dayGLANCE does. */
export function compareVersions(a, b) {
  const parse = (v) => v.replace(/^v/, '').split('.').map((s) => Number.parseInt(s, 10) || 0)
  const pa = parse(a), pb = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  return 0
}

/** The newer release this OS can install, from the API's answer, or null. */
export function availableUpdate(release, current, platform) {
  if (!release || typeof release !== 'object') return null
  const r = release
  if (r.draft === true || r.prerelease === true) return null
  if (typeof r.tag_name !== 'string' || typeof r.html_url !== 'string') return null
  if (!r.html_url.startsWith('https://github.com/')) return null
  const version = r.tag_name.replace(/^v/, '')
  if (compareVersions(current, version) <= 0) return null
  const pattern = DOWNLOADS[platform]
  const assets = Array.isArray(r.assets) ? r.assets : []
  const installable = !!pattern && assets.some((a) => typeof a?.name === 'string' && pattern.test((a).name))
  return installable ? { version, url: r.html_url } : null
}
