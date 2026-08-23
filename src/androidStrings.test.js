import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { EUROPEAN_ONLY, BRAZILIAN_ONLY } from './ptMarkers.js'

/**
 * CI cannot always compile the Android app, but the string resources are plain
 * XML — so the mistakes that would break the next build (or silently ship
 * English) are checked here instead: a locale carrying a key the base file
 * doesn't have (aapt error), a %1$d placeholder dropped in translation
 * (runtime crash on getString with args), an unescaped apostrophe (aapt
 * error), a translatable key missing from a locale (silently English), or a
 * wrong-standard Portuguese word — the same guardrail the web locales get.
 * Mirrors lastGLANCE's src/androidStrings.test.ts.
 */
const RES = join(__dirname, '../android/app/src/main/res')

// Brand and configuration values, deliberately base-only.
const UNTRANSLATED = new Set(['app_name', 'title_activity_main', 'package_name', 'custom_url_scheme'])

// values-xx, values-xx-rYY, and BCP-47 dirs like values-b+zh+Hant.
const LOCALE_DIR = /^values-([a-z]{2}(-r[A-Z]{2})?|b\+[a-z]{2,3}(\+[A-Za-z]+)+)$/

function parseStrings(path) {
  const xml = readFileSync(path, 'utf8')
  const strings = new Map()
  for (const m of xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)) {
    strings.set(m[1], m[2])
  }
  // plurals flatten to "name#quantity" so parity and placeholders cover them too
  const plurals = new Map()
  for (const m of xml.matchAll(/<plurals name="([^"]+)">([\s\S]*?)<\/plurals>/g)) {
    const items = new Map()
    for (const im of m[2].matchAll(/<item quantity="([^"]+)">([\s\S]*?)<\/item>/g)) {
      items.set(im[1], im[2])
    }
    plurals.set(m[1], items)
  }
  return { strings, plurals }
}

const base = parseStrings(join(RES, 'values/strings.xml'))
const locales = readdirSync(RES).filter((d) => LOCALE_DIR.test(d))
const placeholders = (v) => (v.match(/%\d\$[sd]/g) ?? []).sort().join(',')

describe('Android string resources', () => {
  it('found the locale directories', () => {
    expect(locales.sort()).toEqual([
      'values-b+zh+Hant',
      'values-de',
      'values-es',
      'values-fr',
      'values-it',
      'values-pt',
      'values-pt-rPT',
      'values-zh',
    ])
  })

  it.each(locales)('%s carries no keys absent from the base file', (loc) => {
    const { strings, plurals } = parseStrings(join(RES, loc, 'strings.xml'))
    expect(strings.size + plurals.size).toBeGreaterThan(0)
    const extra = [
      ...[...strings.keys()].filter((k) => !base.strings.has(k)),
      ...[...plurals.keys()].filter((k) => !base.plurals.has(k)),
    ]
    expect(extra, `${loc} has keys aapt would reject`).toEqual([])
  })

  it.each(locales)('%s translates every translatable key', (loc) => {
    const { strings, plurals } = parseStrings(join(RES, loc, 'strings.xml'))
    const missing = [
      ...[...base.strings.keys()].filter((k) => !UNTRANSLATED.has(k) && !strings.has(k)),
      ...[...base.plurals.keys()].filter((k) => !plurals.has(k)),
    ]
    expect(missing, `${loc} would silently render these in English`).toEqual([])
  })

  it.each(locales)('%s keeps every format placeholder', (loc) => {
    const { strings, plurals } = parseStrings(join(RES, loc, 'strings.xml'))
    const mismatched = [...strings]
      .filter(([k, v]) => placeholders(v) !== placeholders(base.strings.get(k) ?? ''))
      .map(([k]) => k)
    // Every plurals item must carry the base "other" form's placeholders: a
    // language may ship fewer quantities (Chinese has only "other") but never
    // an item that drops the count.
    for (const [k, items] of plurals) {
      const want = placeholders(base.plurals.get(k)?.get('other') ?? '')
      for (const [q, v] of items) {
        if (placeholders(v) !== want) mismatched.push(`${k}#${q}`)
      }
    }
    expect(mismatched, `${loc} placeholder mismatches crash getString at runtime`).toEqual([])
  })

  it.each(['values', ...locales])('%s escapes apostrophes for aapt', (loc) => {
    const { strings, plurals } = parseStrings(join(RES, loc, 'strings.xml'))
    const values = [...strings, ...[...plurals].flatMap(([k, items]) => [...items].map(([q, v]) => [`${k}#${q}`, v]))]
    const bad = values.filter(([, v]) => /(^|[^\\])'/.test(v)).map(([k]) => k)
    expect(bad, `${loc} unescaped apostrophes fail the resource compile`).toEqual([])
  })

  // Same variant guardrail the web locales get: bare values-pt is BRAZILIAN in
  // this app (matching the web's bare "pt" -> pt-BR), values-pt-rPT European.
  it.each([
    ['values-pt', 'Brazilian', EUROPEAN_ONLY],
    ['values-pt-rPT', 'European', BRAZILIAN_ONLY],
  ])('%s uses only the %s standard', (loc, name, forbidden) => {
    const { strings, plurals } = parseStrings(join(RES, loc, 'strings.xml'))
    const values = [...strings, ...[...plurals].flatMap(([k, items]) => [...items].map(([q, v]) => [`${k}#${q}`, v]))]
    const violations = []
    for (const [key, value] of values) {
      for (const [marker, pattern] of Object.entries(forbidden)) {
        const found = value.match(pattern)
        if (found) violations.push(`  ${key}: "${found[0]}" — ${marker}`)
      }
    }
    expect(
      violations,
      `${loc} is meant to be ${name} Portuguese:\n${violations.join('\n')}`
    ).toEqual([])
  })
})
