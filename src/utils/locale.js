// Language-tag hygiene for Intl.
//
// Browsers on real devices hand out clean BCP-47 tags (en-US, zh-CN, …), but
// POSIX/headless environments and some embedded WebViews surface values like
// "en-US@posix", "en_US.UTF-8", "C", or "POSIX". Those are NOT valid BCP-47
// tags, and passing them to Intl.DateTimeFormat / toLocaleString throws a
// RangeError — which, thrown during render, blanks the whole app.

// Normalize a raw language string into a valid BCP-47 tag, or 'en' if nothing
// usable remains. Strips POSIX modifier (@posix) and charset (.UTF-8) suffixes
// and converts the POSIX '_' region separator to BCP-47 '-'.
export function sanitizeLanguageTag(lng) {
  if (!lng || typeof lng !== 'string') return 'en'
  const tag = lng.split('@')[0].split('.')[0].trim().replace(/_/g, '-')
  if (!tag || /^(c|posix)$/i.test(tag)) return 'en' // language-less POSIX locales
  try {
    return Intl.getCanonicalLocales(tag)[0] || 'en'
  } catch {
    // Structurally invalid even after cleanup — fall back to the primary subtag.
    try {
      return Intl.getCanonicalLocales(tag.split('-')[0])[0] || 'en'
    } catch {
      return 'en'
    }
  }
}

// Guard a locale immediately before handing it to Intl. Returns the value
// unchanged when Intl accepts it, otherwise a sanitized tag — so a stale or
// externally-set bad value can never crash a render.
export function safeLocale(lng) {
  try {
    Intl.getCanonicalLocales(lng) // throws RangeError on an invalid tag
    return lng
  } catch {
    return sanitizeLanguageTag(lng)
  }
}
