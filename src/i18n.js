import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import common from './locales/en/common.json'
import onboarding from './locales/en/onboarding.json'
import milestone from './locales/en/milestone.json'
import chapter from './locales/en/chapter.json'
import settings from './locales/en/settings.json'
import sync from './locales/en/sync.json'
import timeline from './locales/en/timeline.json'
import search from './locales/en/search.json'
import help from './locales/en/help.json'
import stats from './locales/en/stats.json'
import importNs from './locales/en/import.json'
import dayglance from './locales/en/dayglance.json'

import frCommon from './locales/fr/common.json'
import frOnboarding from './locales/fr/onboarding.json'
import frMilestone from './locales/fr/milestone.json'
import frChapter from './locales/fr/chapter.json'
import frSettings from './locales/fr/settings.json'
import frSync from './locales/fr/sync.json'
import frTimeline from './locales/fr/timeline.json'
import frSearch from './locales/fr/search.json'
import frHelp from './locales/fr/help.json'
import frStats from './locales/fr/stats.json'
import frImport from './locales/fr/import.json'
import frDayglance from './locales/fr/dayglance.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: [
      'common',
      'onboarding',
      'milestone',
      'chapter',
      'settings',
      'sync',
      'timeline',
      'search',
      'help',
      'stats',
      'import',
      'dayglance',
    ],
    resources: {
      en: {
        common,
        onboarding,
        milestone,
        chapter,
        settings,
        sync,
        timeline,
        search,
        help,
        stats,
        import: importNs,
        dayglance,
      },
      fr: {
        common: frCommon,
        onboarding: frOnboarding,
        milestone: frMilestone,
        chapter: frChapter,
        settings: frSettings,
        sync: frSync,
        timeline: frTimeline,
        search: frSearch,
        help: frHelp,
        stats: frStats,
        import: frImport,
        dayglance: frDayglance,
      },
    },
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
