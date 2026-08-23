import { describe, it, expect } from 'vitest'
import { nativeLanguageName } from './languageName.js'
import { languages } from '../locales.js'

describe('nativeLanguageName', () => {
  // The point of the picker: someone who cannot read the current UI language
  // has to recognise their own. Each name is therefore in its own language,
  // not the active one — and uppercased in its own casing rules, since Intl
  // returns several of these lowercase ("français", "português").
  it.each([
    ['de', 'Deutsch'],
    ['en', 'English'],
    ['es', 'Español'],
    ['fr', 'Français'],
    ['it', 'Italiano'],
    ['pt', 'Português'],
    ['zh-CN', '中文（中国）'],
    // The 'short' style: the default region name for zh-HK is the official
    // 中國香港特別行政區, far too long for a select option.
    ['zh-HK', '中文（香港）'],
  ])('names %s in its own language', (tag, expected) => {
    expect(nativeLanguageName(tag)).toBe(expected)
  })

  it('covers every shipped language', () => {
    for (const lng of languages) {
      const name = nativeLanguageName(lng)
      expect(name, `${lng} has no display name`).toBeTypeOf('string')
      expect(name, `${lng} fell back to the raw tag`).not.toBe(lng)
    }
  })

  // Both Chinese locales (and later both Portuguese ones) must stay
  // distinguishable — a regression to base-language names would render two
  // identical options.
  it('gives every shipped language a distinct name', () => {
    const names = languages.map(nativeLanguageName)
    expect(new Set(names).size).toBe(names.length)
  })

  it('falls back to the tag rather than throwing on an unknown one', () => {
    expect(nativeLanguageName('zz')).toBe('zz')
    expect(nativeLanguageName(undefined)).toBe(undefined)
  })
})
