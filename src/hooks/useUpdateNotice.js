import { useCallback, useEffect, useState } from 'react'
import { desktopBridge } from '../native/desktop.js'

// The desktop app's "update available" notice (docs/desktop-app.md,
// "Updates"). There is no auto-update: the page asks the main process shortly
// after launch, every 6 hours, and on return to the app; main answers with a
// newer release that has a download for this OS, or null
// (electron/updateCheck.js). Dismissing hides that version for good; a newer
// one shows again. Off the desktop, and on a Mac App Store build, there is
// never anything to show. lastGLANCE's useUpdateNotice.ts.

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
export const FIRST_CHECK_MS = 15 * 1000
export const DISMISSED_KEY = 'lifeglance-update-dismissed'

function dismissedVersion() {
  try { return localStorage.getItem(DISMISSED_KEY) } catch { return null }
}

/** What to show for main's answer: the release, unless it was dismissed or is malformed. */
export function noticeFor(release, dismissed = dismissedVersion()) {
  if (!release || typeof release.version !== 'string' || typeof release.url !== 'string') return null
  return release.version === dismissed ? null : { version: release.version, url: release.url }
}

/** @returns {{ update: { version: string, url: string } | null, dismiss: () => void }} */
export function useUpdateNotice() {
  const [update, setUpdate] = useState(null)

  useEffect(() => {
    const desktop = desktopBridge()
    if (!desktop || desktop.info.isMAS || typeof desktop.shell.latestRelease !== 'function') return
    let live = true
    const check = () => {
      Promise.resolve(desktop.shell.latestRelease()).then((release) => {
        if (live) setUpdate(noticeFor(release))
      }).catch(() => {})
    }
    const first = setTimeout(check, FIRST_CHECK_MS)
    const every = setInterval(check, CHECK_EVERY_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      clearTimeout(first)
      clearInterval(every)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const dismiss = useCallback(() => {
    setUpdate((u) => {
      if (u) { try { localStorage.setItem(DISMISSED_KEY, u.version) } catch { /* this session only */ } }
      return null
    })
  }, [])

  return { update, dismiss }
}
