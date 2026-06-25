import { readFileSync, writeFileSync } from 'node:fs'

// `cap sync ios` regenerates ios/App/CapApp-SPM/Package.swift, and on some
// Capacitor CLI / Xcode SDK combinations it writes an iOS platform that the file's
// declared `swift-tools-version` can't accept (observed: `.iOS(.v26)` under
// swift-tools 5.9), which breaks Swift Package resolution with:
//   "'v26' is unavailable" / "Missing package product 'CapApp-SPM'".
//
// This pins the platform back to the version the app actually targets, so running
// `build:ios` (which runs cap sync) is always safe. No-op when already correct.
const PATH = 'ios/App/CapApp-SPM/Package.swift'
const TARGET = '.iOS(.v15)' // keep in sync with IPHONEOS_DEPLOYMENT_TARGET

try {
  const src = readFileSync(PATH, 'utf8')
  const fixed = src.replace(/\.iOS\(\.v\d+\)/, TARGET)
  if (fixed !== src) {
    writeFileSync(PATH, fixed)
    console.log(`[fix-spm-platform] pinned iOS platform to ${TARGET} in ${PATH}`)
  }
} catch (err) {
  console.warn(`[fix-spm-platform] skipped (${err.message})`)
}
