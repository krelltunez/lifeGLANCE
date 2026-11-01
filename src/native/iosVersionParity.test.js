import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Android derives versionName and versionCode from package.json in
// android/app/build.gradle. iOS has no equivalent: MARKETING_VERSION is written
// into the Xcode project by hand, once per target per configuration, so a
// release bump that touches only package.json leaves the iOS app behind
// silently — and the next App Store upload carries the stale number.
//
// That is not hypothetical. At the 3.6.0 bump the project still read 3.0.1,
// five releases behind, because nothing checked. This is the check.
//
// Apple also requires an app extension's CFBundleShortVersionString to match
// its containing app, so every target must agree, not just the app.

const root = resolve(__dirname, '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const pbx = read('ios/App/App.xcodeproj/project.pbxproj')
const { version } = JSON.parse(read('package.json'))

const values = (key) =>
  [...pbx.matchAll(new RegExp(`${key} = ([^;]+);`, 'g'))].map((m) => m[1].trim())

describe('iOS project version parity', () => {
  it('sets MARKETING_VERSION on every target and configuration', () => {
    // Six today: app, widgets and share extension, each in Debug and Release.
    // A target added without a version would drop this below the app's own two.
    expect(values('MARKETING_VERSION').length).toBeGreaterThanOrEqual(6)
  })

  it('matches package.json on every target and configuration', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    for (const v of values('MARKETING_VERSION')) expect(v).toBe(version)
  })

  it('keeps CURRENT_PROJECT_VERSION consistent across targets', () => {
    // The build number. Its value is a release decision (App Store Connect
    // rejects a repeat for the same version string), but the targets must not
    // disagree with each other.
    const builds = values('CURRENT_PROJECT_VERSION')
    expect(builds.length).toBeGreaterThanOrEqual(6)
    expect([...new Set(builds)]).toHaveLength(1)
  })
})
