import { desktopBridge } from '../native/desktop.js'

// The desktop app's private-address permission, as Cloud Sync sees it
// (docs/desktop-app.md, "Sync through the main process"). The main process
// refuses a server on a private network until the user grants its exact
// origin, and a refused request never reaches the server. So a connection test
// asks first, and says "needs your permission" with an Allow button, rather
// than reporting a network error for a server it never contacted. Off the
// desktop there is no such rule (the phones reach a LAN server directly, the
// web goes through its proxy) and every helper here is a no-op.
// lastGLANCE's src/sync/privateAddress.ts.

const defaultHttp = () => desktopBridge()?.http ?? null

/**
 * Whether the desktop will refuse `url`, before anything is sent. Null when it
 * will go through, off the desktop, or when the check itself fails: it is a
 * diagnostic, never a gate, and the real request reports whatever happens next.
 *
 * @param {string | null | undefined} url
 * @param {object | null} [http]
 * @returns {Promise<{ origin: string, canGrant: boolean } | null>} canGrant is
 *   false for addresses no grant can unlock (link-local, reserved ranges)
 */
export async function checkPrivateAddress(url, http = defaultHttp()) {
  if (!http || !url) return null
  try {
    const verdict = await http.inspect(url)
    return verdict?.blocked ? { origin: verdict.origin, canGrant: verdict.canGrant === true } : null
  } catch {
    return null
  }
}

/** The message a blocked connection test shows. `t` is the `desktop` namespace's. */
export function blockedMessage(t, block) {
  return t(block.canGrant ? 'privateAddress.needsPermission' : 'privateAddress.refused', { origin: block.origin })
}

/**
 * The permission dialog's text. The main process has no locale bundle, so the
 * translated chrome travels with the request; the origin and the addresses it
 * resolves to are added by the main process, where no label can hide them.
 * `kind` picks the warning for a server on this same computer.
 *
 * @param {Function} t the `desktop` namespace's
 * @param {'vault' | 'server'} kind
 */
export function consentLabels(t, kind) {
  return {
    title: t('privateAddress.consentTitle'),
    question: t('privateAddress.consentQuestion'),
    resolvesTo: t('privateAddress.consentResolvesTo'),
    warning: t('privateAddress.consentWarning'),
    warningLoopback: t(kind === 'vault' ? 'privateAddress.consentWarningLoopbackVault' : 'privateAddress.consentWarningLoopbackServer'),
    scope: t('privateAddress.consentScope'),
    allow: t('privateAddress.consentAllow'),
    cancel: t('privateAddress.consentCancel'),
  }
}

/**
 * Show the permission dialog for `url`. Null once the origin is granted, else
 * the message to show (the user declined, or the address cannot be granted).
 */
export async function grantPrivateAddress(t, url, kind, http = defaultHttp()) {
  if (!http) return t('privateAddress.grantFailed')
  try {
    const result = await http.grant(url, consentLabels(t, kind))
    return result?.ok ? null : result?.reason || t('privateAddress.grantFailed')
  } catch {
    return t('privateAddress.grantFailed')
  }
}
