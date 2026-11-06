import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// CI cannot run Xcode on every test run, so the iOS version wiring is checked
// here. MARKETING_VERSION (from package.json) and CURRENT_PROJECT_VERSION (from
// IOS_BUILD) come through the gitignored ios/version.generated.xcconfig
// (scripts/sync-ios-version.mjs), and reach every target (App,
// LifeGlanceWidgetsExtension, LifeGlanceShare) through the project-level base
// configurations. Either value in project.pbxproj would override it for that
// target alone: that is how the project sat at 3.0.1 while package.json moved on
// to 3.6.0, and how an app and its extensions end up shipping different numbers.
//
// Mirrors src/iosVersion.test.ts in lastGLANCE.

const IOS = resolve(__dirname, '../../ios')
const pbx = readFileSync(resolve(IOS, 'App/App.xcodeproj/project.pbxproj'), 'utf8')

describe('iOS version wiring', () => {
  it.each(['MARKETING_VERSION', 'CURRENT_PROJECT_VERSION'])('leaves %s out of project.pbxproj', (key) => {
    expect(pbx).not.toContain(key)
  })

  it.each(['Debug', 'Release'])('bases the project %s configuration on an xcconfig that includes the version', (name) => {
    const list = pbx.match(/Build configuration list for PBXProject "App" \*\/ = \{[\s\S]*?\n\t\t\};/)[0]
    const id = list.match(new RegExp(`([0-9A-F]{24}) /\\* ${name} \\*/`))[1]
    const config = pbx.match(new RegExp(`\\t\\t${id} /\\* ${name} \\*/ = \\{[\\s\\S]*?\\n\\t\\t\\};`))[0]
    const file = config.match(/baseConfigurationReference = [0-9A-F]{24} \/\* (\S+\.xcconfig) \*\//)[1]
    expect(readFileSync(resolve(IOS, file), 'utf8')).toMatch(/^#include "version\.generated\.xcconfig"$/m)
  })

  it('gitignores the generated xcconfig', () => {
    expect(readFileSync(resolve(IOS, '.gitignore'), 'utf8')).toMatch(/^version\.generated\.xcconfig$/m)
  })
})
