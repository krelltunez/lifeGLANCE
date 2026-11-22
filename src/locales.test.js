import { describe, it, expect, beforeAll } from 'vitest'
import { languages, namespaces, loaders, resolveLanguage } from './locales.js'

// Guards the drift that a hand-maintained `resources` object invites: dayGLANCE
// shipped four languages as files with no `resources` entry, and every string
// in them silently rendered in English. A test that only checked the files
// existed would have passed throughout that bug — the assertions below go
// through the same glob-derived loaders i18n.js resolves at runtime.
describe('locale bundles', () => {
  const EXPECTED_LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'pt-BR', 'pt-PT', 'zh-CN', 'zh-HK', 'zh-TW']
  const EXPECTED_NAMESPACES = [
    'billing',
    'chapter',
    'common',
    'dayglance',
    'desktop',
    'help',
    'import',
    'lives',
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

  /**
   * Keys that ship in English in some languages until a translation lands, and
   * which languages are waiting. The parity checks below are satisfied by the
   * English text, so without this list nothing in the repo would say these are
   * untranslated. The point of the list is that it shrinks: each entry must
   * name exactly the languages that still carry en's text, so translating one
   * fails here until the language is dropped, and an empty entry is removed.
   * pt-PT and zh-TW are generated, so they follow pt-BR and zh-HK. Same shape
   * as dayGLANCE's and lastGLANCE's UNTRANSLATED.
   */
  describe('UNTRANSLATED: English on the way to a translation', () => {
    const UNTRANSLATED = {
      // The paywall's two pending outcomes (billing Phase 2) shipped in English
      // first, so no installable version reaches one with nothing to show; the
      // localization pass translates them.
      'billing:purchasePendingApproval': ['de', 'es', 'fr', 'it', 'pt-BR', 'pt-PT', 'zh-CN', 'zh-HK', 'zh-TW'],
      'billing:purchaseUnconfirmed': ['de', 'es', 'fr', 'it', 'pt-BR', 'pt-PT', 'zh-CN', 'zh-HK', 'zh-TW'],
    }
    const get = (lng, nsKey) => {
      const [ns, key] = nsKey.split(':')
      return key.split('.').reduce((o, k) => o?.[k], bundles[lng]?.[ns])
    }

    it.each(Object.keys(UNTRANSLATED))('%s names exactly the languages still in English', (key) => {
      expect(get('en', key), `${key} is not in en; drop it from UNTRANSLATED`).toBeTypeOf('string')
      const stillEnglish = TRANSLATED.filter((lng) => get(lng, key) === get('en', key)).sort()
      expect(
        stillEnglish,
        `UNTRANSLATED['${key}'] must list exactly the languages that still carry en's text. ` +
          'A language translated since is dropped from the list (and the key, once its list is empty); ' +
          'a language listed that does not ship is a typo.'
      ).toEqual([...UNTRANSLATED[key]].sort())
      expect(UNTRANSLATED[key].length, `${key} is translated everywhere; drop it from UNTRANSLATED`).toBeGreaterThan(0)
    })
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
      expect(resolveLanguage('pt-BR')).toBe('pt-BR')
      expect(resolveLanguage('pt-PT')).toBe('pt-PT')
    })

    // The regression this exists to prevent. Portuguese shipped as a single
    // BRAZILIAN "pt" locale before the split (the opposite of dayGLANCE and
    // lastGLANCE), so every existing Portuguese user has "pt" cached in
    // localStorage; resolving it anywhere but pt-BR would silently switch
    // them to the other variant.
    it('moves the pre-split "pt" to Brazilian rather than European or English', () => {
      expect(resolveLanguage('pt')).toBe('pt-BR')
    })

    it('sends European-standard Portuguese regions to pt-PT', () => {
      expect(resolveLanguage('pt-AO')).toBe('pt-PT')
      expect(resolveLanguage('pt-MZ')).toBe('pt-PT')
    })

    it('sends other Portuguese regions to Brazilian', () => {
      expect(resolveLanguage('pt-US')).toBe('pt-BR')
    })

    it('matches a regional tag regardless of case', () => {
      expect(resolveLanguage('zh-cn')).toBe('zh-CN')
      expect(resolveLanguage('ZH-HK')).toBe('zh-HK')
      expect(resolveLanguage('pt-br')).toBe('pt-BR')
      expect(resolveLanguage('PT-PT')).toBe('pt-PT')
    })

    it('reduces a regional tag to a base language that is shipped', () => {
      expect(resolveLanguage('en-US')).toBe('en')
      expect(resolveLanguage('de-AT')).toBe('de')
    })

    // Chinese resolves by script, not by region prefix: Traditional readers
    // must never land on Simplified or vice versa.
    it('sends bare and Simplified Chinese to zh-CN', () => {
      expect(resolveLanguage('zh')).toBe('zh-CN')
      expect(resolveLanguage('zh-SG')).toBe('zh-CN')
      expect(resolveLanguage('zh-Hans')).toBe('zh-CN')
    })

    // Within Traditional, the region picks the file: Hong Kong and Macau read
    // zh-HK, Taiwan — and a script-only "zh-Hant", whose likely region is
    // Taiwan — reads zh-TW.
    it('sends Hong Kong and Macau Traditional Chinese to zh-HK', () => {
      expect(resolveLanguage('zh-HK')).toBe('zh-HK')
      expect(resolveLanguage('zh-MO')).toBe('zh-HK')
      expect(resolveLanguage('zh-Hant-HK')).toBe('zh-HK')
      expect(resolveLanguage('zh-Hant-MO')).toBe('zh-HK')
    })

    it('sends Taiwan and unspecified Traditional Chinese to zh-TW', () => {
      expect(resolveLanguage('zh-TW')).toBe('zh-TW')
      expect(resolveLanguage('zh-Hant')).toBe('zh-TW')
      expect(resolveLanguage('zh-Hant-TW')).toBe('zh-TW')
    })

    // A Traditional reader never lands on Simplified, even when only the
    // other Traditional file ships.
    it('prefers any Traditional file over zh-CN for a Traditional tag', () => {
      expect(resolveLanguage('zh-TW', ['en', 'zh-CN', 'zh-HK'])).toBe('zh-HK')
      expect(resolveLanguage('zh-HK', ['en', 'zh-CN', 'zh-TW'])).toBe('zh-TW')
      expect(resolveLanguage('zh-CN', ['en', 'zh-HK', 'zh-TW'])).toBe('zh-HK')
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
      for (const reported of ['en', 'pt', 'pt-AO', 'zh', 'zh-TW', 'zh-MO', 'de-AT', 'zz', '', undefined]) {
        expect(languages).toContain(resolveLanguage(reported))
      }
    })

    // Mirrors the wiring in i18n.js: the detector sanitizes first, then
    // resolves, so POSIX-style values from WebViews land on a shipped tag.
    it('composes with sanitizeLanguageTag for POSIX-style values', async () => {
      const { sanitizeLanguageTag } = await import('./utils/locale.js')
      expect(resolveLanguage(sanitizeLanguageTag('zh_CN.UTF-8'))).toBe('zh-CN')
      expect(resolveLanguage(sanitizeLanguageTag('zh_TW.UTF-8'))).toBe('zh-TW')
      expect(resolveLanguage(sanitizeLanguageTag('pt_BR@posix'))).toBe('pt-BR')
      expect(resolveLanguage(sanitizeLanguageTag('C'))).toBe('en')
    })
  })
})
