// Translation bundles, derived from what is actually on disk.
//
// These were previously 108 static imports in i18n.js feeding a hand-maintained
// `resources` object — 13 namespace entries per language, repeated eight times.
// That is exactly the structure that drifts: dayGLANCE shipped four languages
// as files with no `resources` entry, and every string in them silently fell
// back to English. Globbing the directory removes the second place that has to
// be kept in sync — adding a language is now just adding src/locales/<lng>/.
//
// Lazy, so only the language in use is downloaded: eagerly inlining all eight
// made every user pay for seven languages they cannot read, and locale data
// only grows. English stays eagerly bundled in i18n.js as the synchronous
// fallback. Each other language is grouped into its own chunk (see
// vite.config.js), small enough to precache individually.
// English is the exception: it is the fallback every other language leans on
// for untranslated keys, so it has to be present synchronously — including
// when a chunk fetch fails offline. It is bundled eagerly (and excluded from
// the lazy glob below so no module is imported both ways), but still
// glob-derived, so a new namespace needs no wiring anywhere.
const enModules = import.meta.glob('./locales/en/*.json', { eager: true, import: 'default' })
const loaderModules = import.meta.glob(['./locales/*/*.json', '!./locales/en/*.json'], {
  import: 'default',
})

// './locales/pt/common.json' -> ['pt', 'common']
function parsePath(path) {
  const parts = path.split('/')
  return [parts.at(-2), parts.at(-1).replace(/\.json$/, '')]
}

// { common: {...}, onboarding: {...}, ... } — already-parsed bundles.
export const en = Object.fromEntries(
  Object.entries(enModules).map(([path, bundle]) => [parsePath(path)[1], bundle])
)

// { pt: { common: () => Promise<bundle>, ... }, ... } — en included so every
// language resolves through the same interface.
export const loaders = {
  en: Object.fromEntries(Object.entries(en).map(([ns, bundle]) => [ns, () => Promise.resolve(bundle)])),
}
for (const [path, load] of Object.entries(loaderModules)) {
  const [lng, ns] = parsePath(path)
  ;(loaders[lng] ??= {})[ns] = load
}

// Sorted so the values are stable across platforms — glob key order follows the
// filesystem, which is not guaranteed to match between a dev machine and CI.
export const languages = Object.keys(loaders).sort()
export const namespaces = Object.keys(en).sort()

/**
 * Which regional variant a bare language tag means when more than one ships.
 * Bare "zh" is overwhelmingly Simplified in practice (script handling for
 * Traditional tags is below, before this table is consulted).
 */
const REGIONAL_DEFAULTS = { zh: 'zh-CN' }

// Simplified and Traditional Chinese are different writing systems, not
// regional flavours, so Chinese resolves by script rather than by prefix:
// zh-TW/zh-MO/zh-Hant-* must land on zh-HK, never on zh-CN. maximize() fills
// in the likely script for region-only tags (zh-TW -> zh-Hant-TW).
function isTraditionalChinese(tag) {
  try {
    return new Intl.Locale(tag).maximize().script === 'Hant'
  } catch {
    return /^zh\b.*\b(hant|tw|hk|mo)\b/i.test(tag.replace(/[_-]/g, ' '))
  }
}

/**
 * Map any language tag onto one this app actually ships.
 *
 * Used in two places that must agree: the detector, so a stored or browser tag
 * resolves before i18next sees it, and the language picker, so the select
 * always has a matching option. If they disagreed, the UI would render one
 * language while the picker displayed another.
 */
export function resolveLanguage(reported, available = languages) {
  const fallback = available.includes('en') ? 'en' : available[0]
  if (!reported || typeof reported !== 'string') return fallback

  if (available.includes(reported)) return reported

  // "pt-br" from a browser that lower-cases the region.
  const exact = available.find((l) => l.toLowerCase() === reported.toLowerCase())
  if (exact) return exact

  const base = reported.split('-')[0].toLowerCase()

  if (base === 'zh') {
    const variant = isTraditionalChinese(reported) ? 'zh-HK' : 'zh-CN'
    if (available.includes(variant)) return variant
  }

  if (available.includes(base)) return base

  const preferred = REGIONAL_DEFAULTS[base]
  if (preferred && available.includes(preferred)) return preferred

  // A regional tag for a language we ship only regionally, with no default
  // declared — any variant beats falling through to English.
  const sameLanguage = available.find((l) => l.split('-')[0].toLowerCase() === base)
  return sameLanguage ?? fallback
}
