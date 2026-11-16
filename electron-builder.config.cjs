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
// There is no Mac App Store target yet: it needs the sandbox entitlements, a
// provisioning profile and billing (the doc's "What is next").

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

/** @type {import('electron-builder').Configuration} */
module.exports = {
  // com.lifeglance.app matches Android. A Mac App Store build would switch to
  // com.lifeglance, the iOS bundle id, for Universal Purchase.
  appId: 'com.lifeglance.app',
  productName: 'lifeGLANCE',
  copyright: 'Copyright © 2026 GLANCE Apps',
  afterPack: './scripts/codesign-ad-hoc.cjs',
  // Notarizes a Developer ID build; a no-op without CSC_LINK.
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
  // is left out whole. Tests and sourcemaps stay out of the package.
  // builderConfig.test.js holds the main process to that.
  files: [
    'dist/**/*',
    'electron/*.js',
    'electron/preload.cjs',
    '!electron/*.test.js',
    '!**/*.map',
    '!node_modules/**/*',
  ],
  mac: {
    // null: ad-hoc (no certificate); undefined: electron-builder picks the
    // Developer ID identity when CSC_LINK is set.
    identity: hasCert ? undefined : null,
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
    },
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
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
