// electron-builder config for the lifeGLANCE desktop app (docs/desktop-app.md,
// "Packaging"). After lastGLANCE's electron-builder.config.cjs, itself
// dayGLANCE's, whose lessons are kept in the comments below.
//
// Signing is driven by the environment:
//
//   Developer ID (release-desktop.yml, or locally with these set):
//     CSC_LINK, CSC_KEY_PASSWORD      the Developer ID Application .p12
//     APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID  for notarization
//   With no CSC_LINK, macOS builds are ad-hoc signed by the afterPack hook (an
//   "unidentified developer" prompt instead of a hard "damaged" block).
//
//   Mac App Store (npm run build:electron:mas, built on a Mac and uploaded with
//   Transporter; docs/desktop-app.md, "The Mac App Store build"): the "Apple
//   Distribution" (or "3rd Party Mac Developer Application") and "Mac Installer
//   Distribution" certificates in the login keychain, and the provisioning
//   profile at electron/lifeglance.mas.provisionprofile (git-ignored) or
//   wherever MAC_PROVISIONING_PROFILE points.

const { readdirSync } = require('node:fs')
const path = require('node:path')

// The shipped languages, read from where i18n loads them, so a new locale
// reaches the macOS bundle with nothing else to remember.
const SHIPPED_LANGUAGES = readdirSync(path.join(__dirname, 'src', 'locales'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

// Apple's spelling where it differs from ours (CFBundleLocalizations only), as
// the iOS project's knownRegions has them.
const APPLE_LANGUAGE_IDS = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant' }

const hasCert = Boolean(process.env.CSC_LINK)
// The MAS script is the only thing that sets LIFEGLANCE_APP_ID, so it marks a
// MAS build. Such a build signs from the keychain (no CSC_LINK) and must never
// inherit the ad-hoc `identity: null` below, which would skip signing.
const isMasBuild = process.env.LIFEGLANCE_APP_ID === 'com.lifeglance'

// CFBundleVersion for App Store uploads, which must strictly increase:
// YYYYMMDD.HHMM from the build time (BUILD_NUMBER overrides). The marketing
// version stays package.json's. Set on MAS builds only.
function masBuildVersion() {
  if (process.env.BUILD_NUMBER) return process.env.BUILD_NUMBER
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}`
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  // com.lifeglance.app matches Android. The MAS build switches to
  // com.lifeglance, the iOS bundle id, for Universal Purchase. appId is global
  // (there is no per-target override), hence the environment switch.
  appId: process.env.LIFEGLANCE_APP_ID || 'com.lifeglance.app',
  ...(isMasBuild ? { buildVersion: masBuildVersion() } : {}),
  productName: 'lifeGLANCE',
  copyright: 'Copyright © 2026 GLANCE Apps',
  afterPack: './scripts/codesign-ad-hoc.cjs',
  // Notarizes a Developer ID build; a no-op without CSC_LINK and for MAS.
  afterSign: './scripts/notarize.cjs',
  // No native runtime dependency ships (see files), so there is nothing for
  // @electron/rebuild to compile.
  npmRebuild: false,
  directories: {
    buildResources: 'electron/resources',
    output: 'dist-app',
  },
  // The renderer is one Vite bundle, so its dependencies are already inside
  // dist/, and the main process imports only Electron and Node: node_modules
  // is left out. Tests and sourcemaps stay out of the package.
  //
  // The one exception is @glance-apps/billing's main-process half (billing on
  // the Mac App Store build, electron/billingConfig.js), which itself imports
  // only electron and node builtins. Every build carries it, since main
  // imports it on every build. builderConfig.test.js holds all of this.
  files: [
    'dist/**/*',
    'electron/*.js',
    'electron/preload.cjs',
    '!electron/*.test.js',
    '!**/*.map',
    '!node_modules/**/*',
    'node_modules/@glance-apps/billing/package.json',
    'node_modules/@glance-apps/billing/dist/electron-main/**/*',
  ],
  mac: {
    // null: ad-hoc (no certificate); undefined: electron-builder picks the
    // Developer ID identity when CSC_LINK is set, or the distribution identity
    // from the keychain on a MAS build.
    identity: hasCert || isMasBuild ? undefined : null,
    hardenedRuntime: hasCert,
    // Notarization is the afterSign hook's job (scripts/notarize.cjs).
    notarize: false,
    entitlements: 'electron/entitlements.mac.plist',
    entitlementsInherit: 'electron/entitlements.mac.plist',
    category: 'public.app-category.lifestyle',
    icon: 'electron/resources/icon-mac.png',
    // Only the shipped languages' .lproj folders survive; Apple reads the
    // folders as the app's languages (dayGLANCE's listing once claimed 50+).
    electronLanguages: SHIPPED_LANGUAGES,
    extendInfo: {
      CFBundleLocalizations: [...new Set(SHIPPED_LANGUAGES.map((l) => APPLE_LANGUAGE_IDS[l] || l))],
      // Export compliance, as the iOS app declares it (ios/App/App/Info.plist).
      // Without it every Mac App Store upload waits in App Store Connect for
      // the encryption question to be answered by hand. The MAS build's
      // Info.plist takes these keys too: electron-builder lays mas's options
      // over mac's, so an extendInfo under mas would add to this one, and win
      // on a key they share (seen in a mas build's Info.plist, 26.18).
      ITSAppUsesNonExemptEncryption: false,
    },
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
  },
  // The Mac App Store build: sandboxed, so no Hardened Runtime; a universal
  // .pkg (the script passes --mac mas --universal). Its options merge over
  // mac's.
  mas: {
    type: 'distribution',
    hardenedRuntime: false,
    entitlements: 'electron/entitlements.mas.plist',
    entitlementsInherit: 'electron/entitlements.mas.inherit.plist',
    provisioningProfile: process.env.MAC_PROVISIONING_PROFILE || 'electron/lifeglance.mas.provisionprofile',
    category: 'public.app-category.lifestyle',
  },
  win: {
    icon: 'electron/resources/icon.png',
    target: [{ target: 'nsis' }],
  },
  // The AppImage's own options: forces the arch into every AppImage name (x64
  // otherwise loses its suffix and gets downloaded onto ARM), without renaming
  // the deb, which keeps Debian's name_version_arch.deb.
  appImage: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
  linux: {
    // category is REQUIRED (no mapping exists for the mac category; the app
    // would land in "Other"), icon avoids the generic Electron icon, and the
    // description becomes the launcher tooltip.
    category: 'Office',
    description: 'Your life, at a glance. A zoomable timeline for life\'s milestones, past and future.',
    icon: 'electron/resources/icon.png',
    desktop: {
      entry: {
        Keywords: 'timeline;life;milestones;journal;history;biography;',
      },
    },
    // Required by the deb target, which fails the build without it. The
    // project's public contact: it ships inside every package.
    maintainer: 'GLANCE Apps <support@glance-apps.com>',
    // The arch list is explicit: the default is only the build host's arch.
    // Cross-packaging arm64 on x64 is sound while no runtime dependency is
    // native (none ship; see files above).
    target: [
      { target: 'AppImage', arch: ['x64', 'arm64'] },
      { target: 'deb', arch: ['x64', 'arm64'] },
    ],
  },
}
