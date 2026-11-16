// The facts main hands the preload for `bridge.info` (docs/desktop-app.md,
// "The bridge"): the app's version, whether this is the Mac App Store build,
// and whether the OS protects secrets here.
//
// They travel as one command-line switch (webPreferences.additionalArguments)
// because the sandboxed preload cannot reach `app`, and a synchronous IPC round
// trip at boot would block the page. The preload cannot import this module
// either, so it decodes the switch itself; bridgeContract.test.js holds the two
// spellings of the switch equal. lastGLANCE's electron/desktopInfo.ts.

export const DESKTOP_INFO_ARG = '--lifeglance-desktop-info='

/** @param {{ version: string, isMAS: boolean, secureStorage: boolean }} info */
export function encodeDesktopInfo(info) {
  return encodeURIComponent(JSON.stringify(info))
}

/**
 * The decoded switch from an argv, or null when absent or malformed.
 * @param {readonly string[]} argv
 * @returns {{ version: string, isMAS: boolean, secureStorage: boolean } | null}
 */
export function decodeDesktopInfo(argv) {
  const arg = argv.find((a) => a.startsWith(DESKTOP_INFO_ARG))
  if (!arg) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(arg.slice(DESKTOP_INFO_ARG.length)))
    if (typeof parsed.version !== 'string' || typeof parsed.isMAS !== 'boolean' || typeof parsed.secureStorage !== 'boolean') return null
    return { version: parsed.version, isMAS: parsed.isMAS, secureStorage: parsed.secureStorage }
  } catch {
    return null
  }
}
