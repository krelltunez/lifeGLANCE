// From dayGLANCE's scripts/notarize.cjs, by way of lastGLANCE's.
//
// electron-builder afterSign hook: submit the Developer ID-signed .app to
// Apple's notary service and staple the ticket, so Gatekeeper opens it without
// a warning, offline too (docs/desktop-app.md, "Packaging").
//
// Runs only for a real Developer ID build (CSC_LINK set). The afterPack ad-hoc
// hook (codesign-ad-hoc.cjs) runs first and stands down when CSC_LINK is set.
// A Mac App Store build is never sent here: the App Store does its own review
// and the notary service would refuse it.
//
// Required environment (GitHub secrets in release-desktop.yml, or set locally):
//   APPLE_ID                     the Apple ID email
//   APPLE_APP_SPECIFIC_PASSWORD  an app-specific password from appleid.apple.com
//   APPLE_TEAM_ID                the 10-character Team ID

const path = require('path')

exports.default = async function notarizeApp({ appOutDir, packager, electronPlatformName }) {
  if (packager.platform.name !== 'mac') return
  if (electronPlatformName === 'mas') return
  if (!process.env.CSC_LINK) return
  for (const name of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    if (!process.env[name]) throw new Error(`[notarize] ${name} is not set; a signed build cannot be notarized without it`)
  }

  // Required here, not at the top: only a signed macOS build needs the package.
  const { notarize } = require('@electron/notarize')
  const appPath = path.join(appOutDir, `${packager.appInfo.productName}.app`)
  console.log(`[notarize] Submitting ${appPath} to the Apple notary service`)
  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })
  console.log('[notarize] Notarized and stapled.')
}
