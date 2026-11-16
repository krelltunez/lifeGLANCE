import { describe, it, expect, vi } from 'vitest'
import { collectCssVariables, embeddedFontFaces, REQUIRED_EXPORT_TOKENS } from './exportImageHelpers'

// These tests target the image-export token-inlining logic in isolation. The
// real export rasterizes an SVG via <img> + canvas, which the vitest 'node'
// environment cannot do (no canvas, no SVG rendering), so we test the pure
// helper that fixes the bug: collecting the :root CSS custom properties to copy
// onto the exported SVG clone. A fake CSSStyleDeclaration stands in for
// getComputedStyle(document.documentElement).

// Build a fake CSSStyleDeclaration: indexable + length for enumeration, plus a
// getPropertyValue(name) lookup. `enumerated` controls which names the engine
// "exposes" by index; `values` is the name→value map getPropertyValue reads.
function fakeRootStyle(values, enumerated = Object.keys(values)) {
  const style = {
    length: enumerated.length,
    getPropertyValue: (name) => values[name] ?? '',
  }
  enumerated.forEach((name, i) => { style[i] = name })
  return style
}

describe('collectCssVariables', () => {
  it('collects every enumerated custom property with a value', () => {
    const style = fakeRootStyle({
      '--bg': '#0F1117',
      '--text-rgb': '232, 224, 208',
      '--amber': '#C8A96E',
    })
    const pairs = collectCssVariables(style)
    const map = Object.fromEntries(pairs)
    expect(map['--bg']).toBe('#0F1117')
    expect(map['--text-rgb']).toBe('232, 224, 208')
    expect(map['--amber']).toBe('#C8A96E')
  })

  it('ignores non-custom properties surfaced by enumeration', () => {
    const style = fakeRootStyle(
      { '--bg': '#0F1117', color: 'red', 'font-size': '16px' },
      ['--bg', 'color', 'font-size'],
    )
    const names = collectCssVariables(style).map(([n]) => n)
    expect(names).toContain('--bg')
    expect(names).not.toContain('color')
    expect(names).not.toContain('font-size')
  })

  it('includes the required tokens even when the engine enumerates nothing', () => {
    // Simulate an engine that does NOT enumerate custom properties (length 0)
    // but still resolves them by name — the belt-and-suspenders path.
    const values = Object.fromEntries(REQUIRED_EXPORT_TOKENS.map((t) => [t, `val${t}`]))
    const style = fakeRootStyle(values, []) // nothing enumerated
    const names = collectCssVariables(style).map(([n]) => n)
    for (const token of REQUIRED_EXPORT_TOKENS) {
      expect(names).toContain(token)
    }
  })

  it('skips tokens that resolve to an empty string', () => {
    const style = fakeRootStyle({ '--bg': '#0F1117', '--missing': '   ' }, ['--bg', '--missing'])
    const names = collectCssVariables(style).map(([n]) => n)
    expect(names).toContain('--bg')
    expect(names).not.toContain('--missing')
  })

  it('trims whitespace around values (getComputedStyle often pads them)', () => {
    const style = fakeRootStyle({ '--text-rgb': '  232, 224, 208  ' })
    expect(Object.fromEntries(collectCssVariables(style))['--text-rgb']).toBe('232, 224, 208')
  })

  it('does not duplicate a token that is both enumerated and required', () => {
    const style = fakeRootStyle({ '--bg': '#0F1117' }, ['--bg'])
    const bgPairs = collectCssVariables(style).filter(([n]) => n === '--bg')
    expect(bgPairs).toHaveLength(1)
  })

  it('covers the tokens the timeline SVG actually uses', () => {
    // The bug was these resolving to nothing in the exported SVG. Guard that the
    // required set still names the tokens Timeline.jsx colours its cards with.
    for (const token of ['--bg', '--bg-deep-rgb', '--text-rgb', '--amber', '--amber-rgb', '--success']) {
      expect(REQUIRED_EXPORT_TOKENS).toContain(token)
    }
  })
})

// The desktop app bundles the typeface, so the export reads the faces from the
// page's own stylesheets instead of from Google Fonts.
describe('embeddedFontFaces', () => {
  const face = (props, cssText = '@font-face { }') => ({
    cssText,
    style: { getPropertyValue: (name) => props[name] ?? '' },
  })
  const courier = (src, extra = {}) => face({ 'font-family': '"Courier Prime"', 'font-style': 'normal', 'font-weight': '400', src, ...extra })
  const doc = (sheets) => ({ baseURI: 'app://lifeglance/', styleSheets: sheets })

  it('inlines each woff2 of the family, with its style, weight and range', async () => {
    const fetchBytes = vi.fn(async () => new Uint8Array([1, 2, 3]))
    const css = await embeddedFontFaces(doc([{
      href: 'app://lifeglance/assets/index-abc.css',
      cssRules: [
        courier('url("courier-prime-latin-400-normal-x.woff2") format("woff2"), url("courier-prime-latin-400-normal-x.woff") format("woff")', { 'unicode-range': 'U+0000-00FF' }),
        courier('url(/assets/courier-prime-latin-700-italic-y.woff2) format("woff2")', { 'font-style': 'italic', 'font-weight': '700' }),
      ],
    }]), 'Courier Prime', { fetchBytes })
    expect(fetchBytes.mock.calls.map((c) => c[0])).toEqual([
      'app://lifeglance/assets/courier-prime-latin-400-normal-x.woff2',   // relative to the stylesheet
      'app://lifeglance/assets/courier-prime-latin-700-italic-y.woff2',
    ])
    const blocks = css.split('\n')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toBe("@font-face { font-family: 'Courier Prime'; font-style: normal; font-weight: 400; unicode-range: U+0000-00FF; src: url('data:font/woff2;base64,AQID') format('woff2'); }")
    expect(blocks[1]).toContain('font-style: italic; font-weight: 700;')
    expect(blocks[1]).not.toContain('unicode-range')
  })

  it('leaves out other families, other rules, and a face with no woff2', async () => {
    const fetchBytes = vi.fn(async () => new Uint8Array([1]))
    const css = await embeddedFontFaces(doc([{
      href: 'app://lifeglance/assets/index.css',
      cssRules: [
        face({ 'font-family': 'Other', src: 'url(o.woff2)' }),
        { cssText: '.btn { color: red }', style: { getPropertyValue: () => '' } },
        { cssText: '@media print { }' },
        courier('url(old.woff) format("woff")'),
      ],
    }]), 'Courier Prime', { fetchBytes })
    expect(css).toBe('')
    expect(fetchBytes).not.toHaveBeenCalled()
  })

  it('skips a stylesheet it may not read and a file it cannot fetch', async () => {
    const crossOrigin = { href: 'https://elsewhere.example/x.css', get cssRules() { throw new Error('SecurityError') } }
    const fetchBytes = vi.fn(async (url) => { if (url.includes('missing')) throw new Error('404'); return new Uint8Array([255]) })
    const css = await embeddedFontFaces(doc([
      crossOrigin,
      { href: null, cssRules: [courier('url(/assets/missing.woff2)'), courier('url(/assets/there.woff2)')] },
    ]), 'Courier Prime', { fetchBytes })
    expect(css.split('\n')).toHaveLength(1)
    expect(css).toContain('base64,/w==')
    expect(fetchBytes).toHaveBeenCalledWith('app://lifeglance/assets/there.woff2')   // no stylesheet URL: the document's
  })

  it('answers nothing for a document with no stylesheets', async () => {
    expect(await embeddedFontFaces({ styleSheets: [] }, 'Courier Prime')).toBe('')
    expect(await embeddedFontFaces(null, 'Courier Prime')).toBe('')
  })
})
