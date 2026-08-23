import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { sanitizeLanguageTag } from './utils/locale'
import { en, loaders, languages, namespaces, resolveLanguage } from './locales.js'

// Resolves language/namespace bundles from the lazy chunks in locales.js.
// i18next only asks for a language it is about to use, so this fetches one
// language's chunk, not all eight.
const lazyBundles = {
  type: 'backend',
  init() {},
  read(lng, ns, callback) {
    const load = loaders[lng]?.[ns]
    // Not a crash: i18next falls back to en, which is bundled above.
    if (!load) return callback(new Error(`no translation bundle for ${lng}/${ns}`), null)
    load().then(
      (bundle) => callback(null, bundle),
      (err) => callback(err, null)
    )
  },
}

export const ready = i18n
  .use(lazyBundles)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: languages,
    defaultNS: 'common',
    ns: namespaces,
    // en is eagerly bundled (see locales.js): it is the synchronous fallback
    // for untranslated keys and for chunk fetches that fail offline.
    resources: {
      en,
    },
    // Without this, the inlined en above would tell i18next every language is
    // already in memory and the backend would never be consulted.
    partialBundledLanguages: true,
    detection: {
      // A detected language can be a POSIX-style value (e.g. "en-US@posix")
      // that is not a valid BCP-47 tag; sanitize it so i18n.language is always
      // safe to pass to Intl, then resolve it onto a language this app ships
      // (zh-TW -> zh-HK, en-US -> en). Applies to every detection source, the
      // localStorage cache included, so a stale stored tag is corrected in
      // place on first load with no separate migration.
      convertDetectedLanguage: (lng) => resolveLanguage(sanitizeLanguageTag(lng)),
    },
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
