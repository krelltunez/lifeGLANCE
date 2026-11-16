// Which URLs the shell hands to the operating system (docs/desktop-app.md,
// "Hardening"). Web pages open in the browser (a milestone's link, the Help
// screen's links) and mailto: links in the mail client. Every other scheme
// (javascript:, file:, custom protocols) is dropped, so a link saved on a
// milestone, which can arrive from another device through sync or an import,
// cannot launch a local program. lastGLANCE's electron/externalLinks.ts.

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

export function isAllowedExternalUrl(url) {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}
