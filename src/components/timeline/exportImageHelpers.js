// Pure helpers for the timeline image export (handleExportImage in
// TimelineView.jsx). Extracted here ONLY so they can be unit-tested without a
// DOM — they have no effect on the app's runtime/rendering behaviour; they are
// used solely while building the exported PNG.

// CSS custom properties (design tokens) the timeline SVG references. Some engines
// don't enumerate custom properties via getComputedStyle, so we always include
// this set explicitly in addition to whatever enumeration returns. Keep in sync
// with the var(--…) tokens used in Timeline.jsx / the export's watermark + bg.
export const REQUIRED_EXPORT_TOKENS = [
  '--bg', '--bg-deep', '--bg-deep-rgb',
  '--text', '--text-rgb',
  '--amber', '--amber-rgb',
  '--success', '--shadow-rgb', '--indigo',
]

/**
 * Collect the CSS custom properties to inline into the exported SVG clone.
 *
 * The timeline SVG colours itself with var(--token) references resolved against
 * the host document's :root. A serialized SVG rendered via <img> has its own root
 * with no access to those tokens, so they must be copied onto the clone. This
 * returns the [name, value] pairs to set, taken from the live computed style so
 * the active (dark/light) theme is captured automatically.
 *
 * @param {CSSStyleDeclaration} rootStyle  getComputedStyle(document.documentElement)
 * @param {string[]} [extra]  token names to force-include (default: REQUIRED_EXPORT_TOKENS)
 * @returns {Array<[string, string]>} name/value pairs with non-empty values
 */
export function collectCssVariables(rootStyle, extra = REQUIRED_EXPORT_TOKENS) {
  const names = new Set()
  // Enumerate every custom property the engine exposes on :root.
  for (let i = 0; i < rootStyle.length; i++) {
    const prop = rootStyle[i]
    if (typeof prop === 'string' && prop.startsWith('--')) names.add(prop)
  }
  // Union with the tokens we know the SVG needs, in case enumeration omits them.
  for (const prop of extra) names.add(prop)

  const pairs = []
  for (const name of names) {
    const value = (rootStyle.getPropertyValue(name) || '').trim()
    if (value) pairs.push([name, value])
  }
  return pairs
}
