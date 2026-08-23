import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EUROPEAN_ONLY, BRAZILIAN_ONLY } from './ptMarkers.js'

/**
 * CI cannot run Xcode, so the string catalogs and their project wiring are
 * validated here instead: a language dropped from a key ships English on that
 * device, a format specifier lost in translation truncates or crashes at
 * render, a duplicate pbxproj object id corrupts the project the next time
 * Xcode loads it, and a wrong-standard Portuguese word is exactly what the
 * variant guardrail exists to stop. Mirrors lastGLANCE's src/iosStrings.test.ts,
 * adapted to this project's Xcode-16 layout: the widget and share extensions
 * use file-system-synchronized groups (their catalogs are picked up from disk
 * with no per-file pbxproj entries), while the App target's classic group
 * carries explicit references.
 */
const IOS = join(__dirname, '../ios/App')
const CATALOGS = [
  'LifeGlanceWidgets/Localizable.xcstrings',
  'LifeGlanceShare/Localizable.xcstrings',
  'App/Localizable.xcstrings',
  'App/AppShortcuts.xcstrings',
]
const PBXPROJ = join(IOS, 'App.xcodeproj/project.pbxproj')

const LANGS = ['de', 'es', 'fr', 'it', 'pt-BR', 'pt-PT', 'zh-Hans', 'zh-Hant']

const specifiers = (v) => (v.match(/%(lld|@|d)/g) ?? []).sort().join(',')

describe.each(CATALOGS)('%s', (rel) => {
  const catalog = JSON.parse(readFileSync(join(IOS, rel), 'utf8'))
  const entries = Object.entries(catalog.strings)

  it('parses and declares en as the source language', () => {
    expect(catalog.sourceLanguage).toBe('en')
    expect(entries.length).toBeGreaterThan(2)
  })

  it.each(LANGS)('every key carries a translated %s value', (lng) => {
    const missing = entries
      .filter(([, e]) => e.localizations && !e.localizations[lng]?.stringUnit?.value)
      .map(([k]) => k)
    expect(missing, `these keys would render English on ${lng} devices`).toEqual([])
  })

  it('keeps every format specifier in every translation', () => {
    const bad = []
    for (const [key, e] of entries) {
      for (const [lng, unit] of Object.entries(e.localizations ?? {})) {
        if (specifiers(unit.stringUnit.value) !== specifiers(key)) bad.push(`${lng}: ${key}`)
      }
    }
    expect(bad, 'specifier mismatches truncate or crash at render').toEqual([])
  })

  it('keeps ${applicationName} in every shortcut phrase', () => {
    for (const [key, e] of entries) {
      if (!key.includes('${applicationName}')) continue
      for (const [lng, unit] of Object.entries(e.localizations ?? {})) {
        expect(
          unit.stringUnit.value.includes('${applicationName}'),
          `${lng}: "${key}" dropped the app-name token Siri requires`
        ).toBe(true)
      }
    }
  })

  it('holds pt-PT to the European standard', () => {
    const violations = []
    for (const [key, e] of entries) {
      const v = e.localizations?.['pt-PT']?.stringUnit?.value ?? ''
      for (const [marker, pattern] of Object.entries(BRAZILIAN_ONLY)) {
        if (pattern.test(v)) violations.push(`${key}: "${v}" — ${marker}`)
      }
    }
    expect(violations).toEqual([])
  })

  // Flipped relative to lastGLANCE's app: here pt-BR is the variant that
  // matches this app's original Portuguese.
  it('holds pt-BR to the Brazilian standard', () => {
    const violations = []
    for (const [key, e] of entries) {
      const v = e.localizations?.['pt-BR']?.stringUnit?.value ?? ''
      for (const [marker, pattern] of Object.entries(EUROPEAN_ONLY)) {
        if (pattern.test(v)) violations.push(`${key}: "${v}" — ${marker}`)
      }
    }
    expect(violations).toEqual([])
  })
})

describe('pbxproj wiring', () => {
  const pbx = readFileSync(PBXPROJ, 'utf8')

  it('defines every object id exactly once', () => {
    const defined = [...pbx.matchAll(/^\t\t([0-9A-F]{24}) [^=]*= \{/gm)].map((m) => m[1])
    const dupes = defined.filter((id, i) => defined.indexOf(id) !== i)
    expect(dupes, 'duplicate ids corrupt the project when Xcode next loads it').toEqual([])
  })

  it('registers the App-target catalogs as files, build files, and resources', () => {
    expect(pbx.match(/\/\* Localizable\.xcstrings \*\/ = \{isa = PBXFileReference/g)?.length).toBe(1)
    expect(pbx.match(/\/\* AppShortcuts\.xcstrings \*\/ = \{isa = PBXFileReference/g)?.length).toBe(1)
    expect(pbx.match(/\/\* Localizable\.xcstrings in Resources \*\/ = \{isa = PBXBuildFile/g)?.length).toBe(1)
    expect(pbx.match(/\/\* AppShortcuts\.xcstrings in Resources \*\/ = \{isa = PBXBuildFile/g)?.length).toBe(1)
    // definition + group child + resources-phase usage
    expect(pbx.match(/Localizable\.xcstrings/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('syncs the extension folders that carry the other two catalogs', () => {
    // Synchronized root groups pull Localizable.xcstrings from disk into the
    // widget and share targets; if these groups go away, the catalogs need
    // explicit references like the App target's.
    expect(pbx).toMatch(/PBXFileSystemSynchronizedRootGroup;.*path = LifeGlanceWidgets;/)
    expect(pbx).toMatch(/PBXFileSystemSynchronizedRootGroup;.*path = LifeGlanceShare;/)
    // and neither exception set excludes the catalog from its target
    for (const m of pbx.matchAll(/membershipExceptions = \(([^)]*)\)/g)) {
      expect(m[1]).not.toContain('Localizable.xcstrings')
    }
  })

  it('declares every catalog language in knownRegions', () => {
    const region = pbx.slice(pbx.indexOf('knownRegions'), pbx.indexOf(');', pbx.indexOf('knownRegions')))
    for (const lng of LANGS) expect(region, `knownRegions missing ${lng}`).toContain(lng)
  })
})
