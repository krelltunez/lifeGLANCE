/**
 * The language's own name for itself, derived from the tag rather than a table
 * that would have to be kept in step with the locale directory.
 *
 * Intl returns these lowercase in several languages ("français", "português"),
 * which is right mid-sentence but reads as a typo in a standalone list, so the
 * first letter is uppercased in the language's own casing rules.
 *
 * 'standard' composes regional variants as "language (Region)" — the default
 * 'dialect' mode picks ICU-version-dependent dialect names ("português
 * europeu") that break the parenthetical pattern. 'short' keeps every name the
 * same except the region: zh-HK's official long form 中文（中國香港特別行政區）
 * becomes 中文（香港）.
 */
export function nativeLanguageName(tag) {
  try {
    const name = new Intl.DisplayNames([tag], {
      type: 'language',
      languageDisplay: 'standard',
      style: 'short',
    }).of(tag)
    // Intl echoes the input back when it has no name for the tag.
    if (!name || name === tag) return tag
    return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1)
  } catch {
    return tag
  }
}
