#!/usr/bin/env node
// Keep the iOS project's version settings consistent across every target.
//
// Two separate jobs, because the two numbers answer different questions:
//
//   MARKETING_VERSION (CFBundleShortVersionString) is the version users see and
//   tracks package.json, the iOS analogue of the package.json-derived versionName
//   in android/app/build.gradle. Always rewritten to match.
//
//   CURRENT_PROJECT_VERSION (CFBundleVersion) is the build number. App Store
//   Connect requires the (marketing version, build number) PAIR to be unique, so
//   this has to increment per UPLOAD, not per version — which is exactly why it
//   cannot be derived from package.json: you routinely ship several TestFlight
//   builds of one version. Set it explicitly:
//
//       IOS_BUILD=7 npm run build:ios
//
//   With IOS_BUILD unset the build number is left alone, but every target is
//   checked for agreement. That check is the point of this half of the script:
//   an app and its extensions MUST ship the same CFBundleVersion or App Store
//   Connect rejects the upload at validation, and Xcode's General tab edits only
//   the target you happen to have selected. lifeGLANCE has three targets — App,
//   LifeGlanceWidgetsExtension and LifeGlanceShare — so bumping the build number
//   by hand moves one and silently leaves two behind.
//
// Mirrors scripts/sync-ios-version.mjs in lastGLANCE; keep the two in step.
//
// Usage: node scripts/sync-ios-version.mjs   (run from the repo root)

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
const pbxPath = resolve(root, 'ios/App/App.xcodeproj/project.pbxproj')

const original = readFileSync(pbxPath, 'utf8')
let pbx = original

// --- Marketing version: always tracks package.json -------------------------

pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
console.log(
  pbx === original
    ? `iOS MARKETING_VERSION already ${version} (no change)`
    : `iOS MARKETING_VERSION -> ${version}`,
)

// --- Build number: explicit, and identical across every target -------------

const found = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map(m => m[1].trim())
if (found.length === 0) {
  console.error('error: no CURRENT_PROJECT_VERSION found in project.pbxproj')
  process.exit(1)
}

const requested = process.env.IOS_BUILD?.trim()

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
  const current = [...new Set(found)]
  if (
    current.length === 1 &&
    /^\d+$/.test(current[0]) &&
    /^\d+$/.test(requested) &&
    Number(requested) <= Number(current[0])
  ) {
    console.warn(
      `warning: IOS_BUILD ${requested} is not greater than the current ${current[0]}. ` +
      'App Store Connect rejects a build number it has already seen for this marketing version.',
    )
  }

  pbx = pbx.replace(
    /CURRENT_PROJECT_VERSION = [^;]+;/g,
    `CURRENT_PROJECT_VERSION = ${requested};`,
  )
  console.log(`iOS CURRENT_PROJECT_VERSION -> ${requested} (${found.length} build configs)`)
} else {
  const distinct = [...new Set(found)]
  if (distinct.length > 1) {
    console.error(
      `error: CURRENT_PROJECT_VERSION disagrees across targets: ${distinct.join(', ')}.\n` +
      '       An app and its extensions must ship the same CFBundleVersion or the\n' +
      '       App Store Connect upload is rejected. Set them all with:\n' +
      `           IOS_BUILD=<n> npm run build:ios`,
    )
    process.exit(1)
  }
  console.log(
    `iOS CURRENT_PROJECT_VERSION is ${distinct[0]} across ${found.length} build configs ` +
    '(unchanged; set IOS_BUILD to bump)',
  )
}

if (pbx !== original) writeFileSync(pbxPath, pbx)
