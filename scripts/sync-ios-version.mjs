#!/usr/bin/env node
// Write the iOS version settings to ios/version.generated.xcconfig.
//
// That file is gitignored and included by ios/debug.xcconfig and
// ios/release.xcconfig, the project-level base configurations, so the App,
// LifeGlanceWidgetsExtension and LifeGlanceShare targets all inherit the same
// values and building never touches the committed project.pbxproj. Two
// numbers, because they answer different questions:
//
//   MARKETING_VERSION (CFBundleShortVersionString) is the version users see and
//   tracks package.json, the iOS analogue of the package.json-derived versionName
//   in android/app/build.gradle.
//
//   MARKETING_VERSION in the environment overrides it for ONE build, without
//   touching package.json. App Store Connect refuses any upload whose marketing
//   version is already published, so a TestFlight build of unreleased work made
//   after a version ships has to carry the next one:
//
//       MARKETING_VERSION=5.2.0 IOS_BUILD=1 npm run build:ios
//
//   The next run without it writes package.json's version back, and the release
//   itself still comes from package.json. Same variable, same meaning, as
//   dayGLANCE's `MARKETING_VERSION=… npm run ios`.
//
//   CURRENT_PROJECT_VERSION (CFBundleVersion) is the build number. App Store
//   Connect requires the (marketing version, build number) PAIR to be unique, so
//   this has to increment per UPLOAD, not per version — which is exactly why it
//   cannot be derived from package.json: you routinely ship several TestFlight
//   builds of one version. Set it explicitly:
//
//       IOS_BUILD=7 npm run build:ios
//
//   With IOS_BUILD unset the last build number written on this machine is kept,
//   and the script fails if there is none yet.
//
// project.pbxproj must not set either value itself: a target-level setting
// silently overrides the xcconfig, and that is how an app and its extensions
// end up shipping different numbers (App Store Connect rejects the upload).
// Xcode writes one when the Version or Build field in a target's General tab
// is edited, so that is checked first.
//
// Mirrors scripts/sync-ios-version.mjs in lastGLANCE; keep the two in step.
//
// Usage: node scripts/sync-ios-version.mjs   (run from the repo root)

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
const pbxPath = resolve(root, 'ios/App/App.xcodeproj/project.pbxproj')
const xcconfigPath = resolve(root, 'ios/version.generated.xcconfig')

// --- Neither value may come from the project ---------------------------------

const pbx = readFileSync(pbxPath, 'utf8')
const overriding = ['MARKETING_VERSION', 'CURRENT_PROJECT_VERSION'].filter(k => pbx.includes(`${k} = `))
if (overriding.length > 0) {
  console.error(
    `error: project.pbxproj sets ${overriding.join(' and ')}, which overrides\n` +
    '       ios/version.generated.xcconfig. Xcode writes these when the Version or\n' +
    '       Build field in a target\'s General tab is edited. Remove those lines;\n' +
    '       the version comes from package.json and the build number from IOS_BUILD.',
  )
  process.exit(1)
}

// --- Marketing version: package.json, or MARKETING_VERSION for one build -----

const override = process.env.MARKETING_VERSION?.trim()
// CFBundleShortVersionString is one to three period-separated integers.
if (override && !/^\d+(\.\d+){0,2}$/.test(override)) {
  console.error(
    `error: MARKETING_VERSION must be one to three period-separated integers, got "${override}"`,
  )
  process.exit(1)
}
const version = override || packageVersion
if (override) {
  console.warn(`MARKETING_VERSION override in effect (${override}); package.json (${packageVersion}) is untouched`)
}

// --- Build number: explicit, or the last one written here --------------------

const previous = existsSync(xcconfigPath) ? readFileSync(xcconfigPath, 'utf8') : ''
const last = previous.match(/^CURRENT_PROJECT_VERSION = (.+)$/m)?.[1].trim()
const requested = process.env.IOS_BUILD?.trim()
let build

if (requested) {
  // CFBundleVersion is one to three period-separated integers.
  if (!/^\d+(\.\d+){0,2}$/.test(requested)) {
    console.error(
      `error: IOS_BUILD must be one to three period-separated integers, got "${requested}"`,
    )
    process.exit(1)
  }

  // Advisory only. A build number must increase within a marketing version, but
  // restarting at 1 after a version bump is legitimate, so this cannot be a hard
  // failure — it just catches the far more common "forgot to increment".
  if (last && /^\d+$/.test(last) && /^\d+$/.test(requested) && Number(requested) <= Number(last)) {
    console.warn(
      `warning: IOS_BUILD ${requested} is not greater than the last build ${last}. ` +
      'App Store Connect rejects a build number it has already seen for this marketing version.',
    )
  }
  build = requested
} else if (last) {
  build = last
} else {
  console.error(
    'error: no iOS build number yet on this machine. Set one with:\n' +
    '           IOS_BUILD=<n> npm run build:ios\n' +
    '       using a number App Store Connect has not seen for this version.',
  )
  process.exit(1)
}

// --- Write ---------------------------------------------------------------------

const xcconfig =
  '// Generated by scripts/sync-ios-version.mjs. Do not edit: the version comes\n' +
  '// from package.json and the build number from IOS_BUILD.\n' +
  (override ? `// MARKETING_VERSION override for this build; package.json says ${packageVersion}.\n` : '') +
  `MARKETING_VERSION = ${version}\n` +
  `CURRENT_PROJECT_VERSION = ${build}\n`

if (xcconfig !== previous) writeFileSync(xcconfigPath, xcconfig)
console.log(
  `iOS MARKETING_VERSION ${version}${override ? ' (override)' : ''}, CURRENT_PROJECT_VERSION ${build}` +
  (requested ? '' : ' (kept; set IOS_BUILD to bump)'),
)
