import { describe, it, expect, beforeAll } from 'vitest'
import { languages, namespaces, loaders, resolveLanguage } from './locales.js'

// Guards the drift that a hand-maintained `resources` object invites: dayGLANCE
// shipped four languages as files with no `resources` entry, and every string
// in them silently rendered in English. A test that only checked the files
// existed would have passed throughout that bug — the assertions below go
// through the same glob-derived loaders i18n.js resolves at runtime.
describe('locale bundles', () => {
  const EXPECTED_LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'pt', 'zh-CN', 'zh-HK']
  const EXPECTED_NAMESPACES = [
    'billing',
    'chapter',
    'common',
    'dayglance',
    'help',
    'import',
    'milestone',
    'onboarding',
    'search',
    'settings',
    'stats',
    'sync',
    'timeline',
  ]
  const TRANSLATED = EXPECTED_LANGUAGES.filter((l) => l !== 'en')

  // bundles[lng][ns] -> parsed JSON, loaded through the runtime loaders
  const bundles = {}
  beforeAll(async () => {
    await Promise.all(
      EXPECTED_LANGUAGES.map(async (lng) => {
        bundles[lng] = {}
        await Promise.all(
          EXPECTED_NAMESPACES.map(async (ns) => {
            bundles[lng][ns] = await loaders[lng][ns]()
          })
        )
      })
    )
  })

  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k
      return v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, key) : [[key, v]]
    })

  // Plural categories legitimately differ per language — en has _one/_other,
  // es adds _many, zh-CN has only _other where a category never occurs — so
  // parity is compared on base keys with the CLDR suffixes stripped. A strict
  // key-for-key comparison would report phantom gaps that are correct CLDR
  // behaviour.
  const stripPlural = (key) => key.replace(/_(zero|one|two|few|many|other)$/, '')

  const baseKeysOf = (lng) => {
    const keys = new Set()
    for (const ns of EXPECTED_NAMESPACES) {
      for (const [key] of flatten(bundles[lng][ns])) keys.add(`${ns}:${stripPlural(key)}`)
    }
    return keys
  }

  it('exposes every shipped language', () => {
    expect(languages).toEqual(EXPECTED_LANGUAGES)
  })

  it('exposes every namespace, derived from en', () => {
    expect(namespaces).toEqual(EXPECTED_NAMESPACES)
  })

  it.each(EXPECTED_LANGUAGES)('%s carries every namespace', (lng) => {
    expect(Object.keys(loaders[lng]).sort()).toEqual(EXPECTED_NAMESPACES)
  })

  it.each(
    EXPECTED_LANGUAGES.flatMap((lng) => EXPECTED_NAMESPACES.map((ns) => [lng, ns]))
  )('%s/%s resolves to a non-empty bundle', (lng, ns) => {
    expect(bundles[lng][ns]).toBeTypeOf('object')
    expect(Object.keys(bundles[lng][ns]).length).toBeGreaterThan(0)
  })

  // A bundle can resolve and still be a stub, or a copy of English that was
  // never translated. This key is carried, translated, by all eight languages.
  it.each(TRANSLATED)('%s translates a shared key into its own text', (lng) => {
    const en = bundles.en.settings.title
    const value = bundles[lng]?.settings?.title
    expect(value, `${lng} is missing settings:title`).toBeTypeOf('string')
    expect(value, `${lng} still carries the English string`).not.toBe(en)
  })

  describe('coverage against en', () => {
    it.each(TRANSLATED)('%s covers every key in en', (lng) => {
      const keys = baseKeysOf(lng)
      const missing = [...baseKeysOf('en')].filter((k) => !keys.has(k))
      expect(
        missing,
        `${lng} is missing keys that en has — translate them:\n  ${missing.slice(0, 10).join('\n  ')}`
      ).toEqual([])
    })

    it.each(TRANSLATED)('%s carries no keys that en does not', (lng) => {
      const en = baseKeysOf('en')
      const extra = [...baseKeysOf(lng)].filter((k) => !en.has(k))
      expect(extra, `${lng} has keys absent from en`).toEqual([])
    })
  })

  // A translation that drops or renames a {{placeholder}} renders the raw
  // braces (or nothing) to the user. Compared per base key as the union across
  // plural forms, since a language without a given plural category cannot
  // carry that form's placeholder.
  describe('placeholder parity with en', () => {
    const placeholdersOf = (lng) => {
      const byKey = new Map()
      for (const ns of EXPECTED_NAMESPACES) {
        for (const [key, value] of flatten(bundles[lng][ns])) {
          if (typeof value !== 'string') continue
          const base = `${ns}:${stripPlural(key)}`
          const set = byKey.get(base) ?? new Set()
          for (const m of value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) set.add(m[1])
          byKey.set(base, set)
        }
      }
      return byKey
    }

    it.each(TRANSLATED)('%s keeps every {{placeholder}} en uses', (lng) => {
      const en = placeholdersOf('en')
      const loc = placeholdersOf(lng)
      const mismatched = []
      for (const [key, enSet] of en) {
        const locSet = loc.get(key)
        if (!locSet) continue // key parity is asserted above
        const a = [...enSet].sort().join(', ')
        const b = [...locSet].sort().join(', ')
        if (a !== b) mismatched.push(`  ${key}: en [${a}] vs ${lng} [${b}]`)
      }
      expect(mismatched, `${lng} placeholder drift:\n${mismatched.join('\n')}`).toEqual([])
    })
  })

  describe('resolveLanguage', () => {
    it('passes through a tag that is already shipped', () => {
      expect(resolveLanguage('de')).toBe('de')
      expect(resolveLanguage('zh-CN')).toBe('zh-CN')
      expect(resolveLanguage('pt')).toBe('pt')
    })

    it('matches a regional tag regardless of case', () => {
      expect(resolveLanguage('zh-cn')).toBe('zh-CN')
      expect(resolveLanguage('ZH-HK')).toBe('zh-HK')
    })

    it('reduces a regional tag to a base language that is shipped', () => {
      expect(resolveLanguage('en-US')).toBe('en')
      expect(resolveLanguage('de-AT')).toBe('de')
      expect(resolveLanguage('pt-BR')).toBe('pt')
    })

    // Chinese resolves by script, not by region prefix: Traditional readers
    // must never land on Simplified or vice versa.
    it('sends bare and Simplified Chinese to zh-CN', () => {
      expect(resolveLanguage('zh')).toBe('zh-CN')
      expect(resolveLanguage('zh-SG')).toBe('zh-CN')
      expect(resolveLanguage('zh-Hans')).toBe('zh-CN')
    })

    it('sends Traditional Chinese to zh-HK', () => {
      expect(resolveLanguage('zh-TW')).toBe('zh-HK')
      expect(resolveLanguage('zh-MO')).toBe('zh-HK')
      expect(resolveLanguage('zh-Hant')).toBe('zh-HK')
      expect(resolveLanguage('zh-Hant-TW')).toBe('zh-HK')
    })

    it('falls back to en for a language that is not shipped', () => {
      expect(resolveLanguage('ja')).toBe('en')
      expect(resolveLanguage('zz-ZZ')).toBe('en')
    })

    it('handles a missing or non-string value', () => {
      expect(resolveLanguage(undefined)).toBe('en')
      expect(resolveLanguage(null)).toBe('en')
      expect(resolveLanguage('')).toBe('en')
      expect(resolveLanguage(42)).toBe('en')
    })

    it('prefers any variant of the right language over English', () => {
      expect(resolveLanguage('pt', ['en', 'pt-BR'])).toBe('pt-BR')
    })

    it('falls back to the first option when en is not shipped', () => {
      expect(resolveLanguage('ja', ['de', 'fr'])).toBe('de')
    })

    it('always returns something the picker can render', () => {
      for (const reported of ['en', 'pt', 'zh', 'zh-TW', 'de-AT', 'zz', '', undefined]) {
        expect(languages).toContain(resolveLanguage(reported))
      }
    })

    // Mirrors the wiring in i18n.js: the detector sanitizes first, then
    // resolves, so POSIX-style values from WebViews land on a shipped tag.
    it('composes with sanitizeLanguageTag for POSIX-style values', async () => {
      const { sanitizeLanguageTag } = await import('./utils/locale.js')
      expect(resolveLanguage(sanitizeLanguageTag('zh_CN.UTF-8'))).toBe('zh-CN')
      expect(resolveLanguage(sanitizeLanguageTag('pt_BR@posix'))).toBe('pt')
      expect(resolveLanguage(sanitizeLanguageTag('C'))).toBe('en')
    })
  })
})
