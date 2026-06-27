import { describe, it, expect } from 'vitest'
import { collectCssVariables, REQUIRED_EXPORT_TOKENS } from './exportImageHelpers'

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
