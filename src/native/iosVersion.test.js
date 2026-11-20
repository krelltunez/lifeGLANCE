import { describe, it, expect } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

// CI cannot run Xcode on every test run, so the iOS version wiring is checked
// here. MARKETING_VERSION (from package.json, or the MARKETING_VERSION
// environment variable for one build) and CURRENT_PROJECT_VERSION (from
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

// scripts/sync-ios-version.mjs itself, run for real against a scratch copy of
// the layout it reads (package.json, project.pbxproj) so the repo's own
// gitignored ios/version.generated.xcconfig is never touched. Mirrors
// lastGLANCE's.
describe('sync-ios-version.mjs', () => {
  const script = resolve(__dirname, '../../scripts/sync-ios-version.mjs')

  function scratch() {
    const dir = mkdtempSync(join(tmpdir(), 'ios-version-'))
    mkdirSync(join(dir, 'scripts'))
    mkdirSync(join(dir, 'ios/App/App.xcodeproj'), { recursive: true })
    copyFileSync(script, join(dir, 'scripts/sync-ios-version.mjs'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '5.1.0' }))
    writeFileSync(join(dir, 'ios/App/App.xcodeproj/project.pbxproj'), '// no version settings\n')
    return dir
  }

  function run(dir, env) {
    const clean = { ...process.env }
    delete clean.MARKETING_VERSION
    delete clean.IOS_BUILD
    const r = spawnSync(process.execPath, [join(dir, 'scripts/sync-ios-version.mjs')], {
      env: { ...clean, ...env },
      encoding: 'utf8',
    })
    const generated = join(dir, 'ios/version.generated.xcconfig')
    return {
      status: r.status,
      output: r.stdout + r.stderr,
      xcconfig: existsSync(generated) ? readFileSync(generated, 'utf8') : null,
      packageJson: readFileSync(join(dir, 'package.json'), 'utf8'),
    }
  }

  it('writes the package.json version by default', () => {
    const r = run(scratch(), { IOS_BUILD: '7' })
    expect(r.status).toBe(0)
    expect(r.xcconfig).toMatch(/^MARKETING_VERSION = 5\.1\.0$/m)
    expect(r.xcconfig).toMatch(/^CURRENT_PROJECT_VERSION = 7$/m)
    expect(r.output).not.toContain('override')
  })

  it('takes MARKETING_VERSION for one build, says so, and leaves package.json alone', () => {
    const dir = scratch()
    const before = readFileSync(join(dir, 'package.json'), 'utf8')
    const r = run(dir, { MARKETING_VERSION: '5.2.0', IOS_BUILD: '1' })
    expect(r.status).toBe(0)
    expect(r.xcconfig).toMatch(/^MARKETING_VERSION = 5\.2\.0$/m)
    expect(r.output).toContain('MARKETING_VERSION override in effect (5.2.0)')
    expect(r.packageJson).toBe(before)

    // The next run without it goes back to package.json, keeping the build number.
    const next = run(dir, {})
    expect(next.xcconfig).toMatch(/^MARKETING_VERSION = 5\.1\.0$/m)
    expect(next.xcconfig).toMatch(/^CURRENT_PROJECT_VERSION = 1$/m)
  })

  it('treats an empty MARKETING_VERSION as unset', () => {
    const r = run(scratch(), { MARKETING_VERSION: '  ', IOS_BUILD: '7' })
    expect(r.status).toBe(0)
    expect(r.xcconfig).toMatch(/^MARKETING_VERSION = 5\.1\.0$/m)
  })

  it.each(['v5.2.0', '5.2.0-beta', '5.2.0.1', '5..0', 'next'])(
    'refuses a malformed MARKETING_VERSION (%s) and writes nothing',
    (bad) => {
      const r = run(scratch(), { MARKETING_VERSION: bad, IOS_BUILD: '7' })
      expect(r.status).toBe(1)
      expect(r.output).toContain('MARKETING_VERSION must be')
      expect(r.xcconfig).toBeNull()
    },
  )
})
