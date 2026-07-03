import { describe, it, expect } from 'vitest'
import { sanitizeLanguageTag, safeLocale } from './locale'

describe('sanitizeLanguageTag', () => {
  it('strips a POSIX @modifier suffix', () => {
    expect(sanitizeLanguageTag('en-US@posix')).toBe('en-US')
  })

  it('strips a charset suffix and normalizes the POSIX region separator', () => {
    expect(sanitizeLanguageTag('en_US.UTF-8')).toBe('en-US')
  })

  it('maps the language-less C / POSIX locales to en', () => {
    expect(sanitizeLanguageTag('C')).toBe('en')
    expect(sanitizeLanguageTag('POSIX')).toBe('en')
  })

  it('falls back to en for empty, null, or non-string input', () => {
    expect(sanitizeLanguageTag('')).toBe('en')
    expect(sanitizeLanguageTag(null)).toBe('en')
    expect(sanitizeLanguageTag(undefined)).toBe('en')
    expect(sanitizeLanguageTag(42)).toBe('en')
  })

  it('passes valid tags through, canonicalizing case', () => {
    expect(sanitizeLanguageTag('en')).toBe('en')
    expect(sanitizeLanguageTag('de')).toBe('de')
    expect(sanitizeLanguageTag('zh-CN')).toBe('zh-CN')
    expect(sanitizeLanguageTag('zh-hk')).toBe('zh-HK')
    expect(sanitizeLanguageTag('zh_TW')).toBe('zh-TW')
  })

  it('recovers the primary subtag when the full tag is unusable', () => {
    expect(sanitizeLanguageTag('en@@@')).toBe('en')
  })

  it('always returns a tag Intl accepts', () => {
    for (const raw of ['en-US@posix', 'en_US.UTF-8', 'C', 'POSIX', '', null, 'zh_TW', 'garble!!']) {
      const out = sanitizeLanguageTag(raw)
      expect(() => new Intl.DateTimeFormat(out)).not.toThrow()
    }
  })
})

describe('safeLocale', () => {
  it('returns a valid tag unchanged', () => {
    expect(safeLocale('en-US')).toBe('en-US')
    expect(safeLocale('zh-CN')).toBe('zh-CN')
  })

  it('sanitizes an invalid tag rather than throwing', () => {
    expect(safeLocale('en-US@posix')).toBe('en-US')
    expect(safeLocale('C')).toBe('en')
  })

  it('never yields a value that makes Intl throw', () => {
    for (const raw of ['en-US@posix', 'C', '', null, 'de_DE.UTF-8']) {
      expect(() => new Intl.DateTimeFormat(safeLocale(raw)).format(new Date())).not.toThrow()
    }
  })
})
