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

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

const defaultFetchBytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer())

/**
 * The @font-face rules of one family, from the page's own stylesheets, with
 * each woff2 file inlined as a data URL, as CSS text for a <style> inside the
 * exported SVG.
 *
 * For the desktop app, which bundles the typeface (vite.config.js,
 * appFontsPlugin) rather than linking Google Fonts: the exported SVG is drawn
 * through an <img>, which loads nothing from outside itself, so the faces have
 * to travel inside it. A face that cannot be read is left out; with none, the
 * answer is '' and the export falls back to the system monospace.
 *
 * @param {Document} doc
 * @param {string} family
 * @param {object} [deps]
 * @param {(url: string) => Promise<Uint8Array>} [deps.fetchBytes]
 * @returns {Promise<string>}
 */
export async function embeddedFontFaces(doc, family, { fetchBytes = defaultFetchBytes } = {}) {
  const faces = []
  for (const sheet of Array.from(doc?.styleSheets ?? [])) {
    let rules
    try { rules = Array.from(sheet.cssRules ?? []) } catch { continue } // a stylesheet from another origin
    for (const rule of rules) {
      const style = rule.style
      if (!style || !String(rule.cssText ?? '').startsWith('@font-face')) continue
      if (style.getPropertyValue('font-family').replace(/["']/g, '').trim() !== family) continue
      const woff2 = /url\(\s*["']?([^"')]+\.woff2[^"')]*)["']?\s*\)/.exec(style.getPropertyValue('src'))
      if (woff2) faces.push({ style, url: woff2[1], base: sheet.href || doc.baseURI })
    }
  }
  const blocks = await Promise.all(faces.map(async ({ style, url, base }) => {
    try {
      const bytes = await fetchBytes(new URL(url, base).href)
      const descriptors = ['font-style', 'font-weight', 'unicode-range']
        .map((name) => [name, style.getPropertyValue(name)])
        .filter(([, value]) => value)
        .map(([name, value]) => `${name}: ${value};`)
      return `@font-face { font-family: '${family}'; ${descriptors.join(' ')} src: url('data:font/woff2;base64,${bytesToBase64(bytes)}') format('woff2'); }`
    } catch {
      return null
    }
  }))
  return blocks.filter(Boolean).join('\n')
}
