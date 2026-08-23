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

// Siri phrases ship as classic per-language AppShortcuts.strings, NOT an
// .xcstrings catalog: the App target deploys to iOS 16 and Xcode's
// appshortcutstringsprocessor rejects the catalog form below iOS 17 (this
// failed the CI build when tried). Keys are the English phrases declared in
// LifeGlanceAppShortcuts; each must exist in every language and keep the
// ${applicationName} token Siri requires.
describe('AppShortcuts.strings', () => {
  const PHRASES = [
    'Add a milestone in ${applicationName}',
    'New milestone in ${applicationName}',
    'Add a ${applicationName} milestone',
  ]

  const parseStrings = (path) =>
    Object.fromEntries(
      [...readFileSync(path, 'utf8').matchAll(/"((?:[^"\\]|\\.)*)" = "((?:[^"\\]|\\.)*)";/g)].map((m) => [m[1], m[2]])
    )

  it.each(LANGS)('%s carries every phrase, with the app-name token', (lng) => {
    const table = parseStrings(join(IOS, `App/${lng}.lproj/AppShortcuts.strings`))
    for (const phrase of PHRASES) {
      const value = table[phrase]
      expect(value, `${lng} is missing "${phrase}"`).toBeTypeOf('string')
      expect(value.includes('${applicationName}'), `${lng}: "${phrase}" dropped the app-name token Siri requires`).toBe(true)
    }
    expect(Object.keys(table).sort()).toEqual([...PHRASES].sort())
  })

  it.each([
    ['pt-PT', BRAZILIAN_ONLY],
    ['pt-BR', EUROPEAN_ONLY],
  ])('holds %s to its standard', (lng, forbidden) => {
    const table = parseStrings(join(IOS, `App/${lng}.lproj/AppShortcuts.strings`))
    const violations = []
    for (const [key, value] of Object.entries(table)) {
      for (const [markerName, pattern] of Object.entries(forbidden)) {
        if (pattern.test(value)) violations.push(`${key}: "${value}" — ${markerName}`)
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

  it('registers the App-target catalog and shortcut strings as files, build files, and resources', () => {
    expect(pbx.match(/\/\* Localizable\.xcstrings \*\/ = \{isa = PBXFileReference/g)?.length).toBe(1)
    expect(pbx.match(/\/\* Localizable\.xcstrings in Resources \*\/ = \{isa = PBXBuildFile/g)?.length).toBe(1)
    expect(pbx.match(/\/\* AppShortcuts\.strings in Resources \*\/ = \{isa = PBXBuildFile/g)?.length).toBe(1)
    // the variant group carries one child per language
    const group = pbx.slice(pbx.indexOf('PBXVariantGroup section'), pbx.indexOf('End PBXVariantGroup section'))
    for (const lng of LANGS) expect(group, `AppShortcuts.strings variant group missing ${lng}`).toContain(`/* ${lng} */`)
    // and the iOS-16 constraint stays honoured: no AppShortcuts catalog
    expect(pbx.includes('AppShortcuts.xcstrings')).toBe(false)
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
