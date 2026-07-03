import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { sanitizeLanguageTag } from './utils/locale'

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

import deCommon from './locales/de/common.json'
import deOnboarding from './locales/de/onboarding.json'
import deMilestone from './locales/de/milestone.json'
import deChapter from './locales/de/chapter.json'
import deSettings from './locales/de/settings.json'
import deSync from './locales/de/sync.json'
import deTimeline from './locales/de/timeline.json'
import deSearch from './locales/de/search.json'
import deHelp from './locales/de/help.json'
import deStats from './locales/de/stats.json'
import deImport from './locales/de/import.json'
import deDayglance from './locales/de/dayglance.json'

import esCommon from './locales/es/common.json'
import esOnboarding from './locales/es/onboarding.json'
import esMilestone from './locales/es/milestone.json'
import esChapter from './locales/es/chapter.json'
import esSettings from './locales/es/settings.json'
import esSync from './locales/es/sync.json'
import esTimeline from './locales/es/timeline.json'
import esSearch from './locales/es/search.json'
import esHelp from './locales/es/help.json'
import esStats from './locales/es/stats.json'
import esImport from './locales/es/import.json'
import esDayglance from './locales/es/dayglance.json'

import itCommon from './locales/it/common.json'
import itOnboarding from './locales/it/onboarding.json'
import itMilestone from './locales/it/milestone.json'
import itChapter from './locales/it/chapter.json'
import itSettings from './locales/it/settings.json'
import itSync from './locales/it/sync.json'
import itTimeline from './locales/it/timeline.json'
import itSearch from './locales/it/search.json'
import itHelp from './locales/it/help.json'
import itStats from './locales/it/stats.json'
import itImport from './locales/it/import.json'
import itDayglance from './locales/it/dayglance.json'

import ptCommon from './locales/pt/common.json'
import ptOnboarding from './locales/pt/onboarding.json'
import ptMilestone from './locales/pt/milestone.json'
import ptChapter from './locales/pt/chapter.json'
import ptSettings from './locales/pt/settings.json'
import ptSync from './locales/pt/sync.json'
import ptTimeline from './locales/pt/timeline.json'
import ptSearch from './locales/pt/search.json'
import ptHelp from './locales/pt/help.json'
import ptStats from './locales/pt/stats.json'
import ptImport from './locales/pt/import.json'
import ptDayglance from './locales/pt/dayglance.json'

import zhCNCommon from './locales/zh_CN/common.json'
import zhCNOnboarding from './locales/zh_CN/onboarding.json'
import zhCNMilestone from './locales/zh_CN/milestone.json'
import zhCNChapter from './locales/zh_CN/chapter.json'
import zhCNSettings from './locales/zh_CN/settings.json'
import zhCNSync from './locales/zh_CN/sync.json'
import zhCNTimeline from './locales/zh_CN/timeline.json'
import zhCNSearch from './locales/zh_CN/search.json'
import zhCNHelp from './locales/zh_CN/help.json'
import zhCNStats from './locales/zh_CN/stats.json'
import zhCNImport from './locales/zh_CN/import.json'
import zhCNDayglance from './locales/zh_CN/dayglance.json'

import zhHKCommon from './locales/zh_HK/common.json'
import zhHKOnboarding from './locales/zh_HK/onboarding.json'
import zhHKMilestone from './locales/zh_HK/milestone.json'
import zhHKChapter from './locales/zh_HK/chapter.json'
import zhHKSettings from './locales/zh_HK/settings.json'
import zhHKSync from './locales/zh_HK/sync.json'
import zhHKTimeline from './locales/zh_HK/timeline.json'
import zhHKSearch from './locales/zh_HK/search.json'
import zhHKHelp from './locales/zh_HK/help.json'
import zhHKStats from './locales/zh_HK/stats.json'
import zhHKImport from './locales/zh_HK/import.json'
import zhHKDayglance from './locales/zh_HK/dayglance.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    // A detected language can be a POSIX-style value (e.g. "en-US@posix") that
    // is not a valid BCP-47 tag; normalize it so i18n.language is always safe to
    // pass to Intl. Applies to every detection source, including cached values.
    detection: { convertDetectedLanguage: sanitizeLanguageTag },
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
      de: {
        common: deCommon,
        onboarding: deOnboarding,
        milestone: deMilestone,
        chapter: deChapter,
        settings: deSettings,
        sync: deSync,
        timeline: deTimeline,
        search: deSearch,
        help: deHelp,
        stats: deStats,
        import: deImport,
        dayglance: deDayglance,
      },
      es: {
        common: esCommon,
        onboarding: esOnboarding,
        milestone: esMilestone,
        chapter: esChapter,
        settings: esSettings,
        sync: esSync,
        timeline: esTimeline,
        search: esSearch,
        help: esHelp,
        stats: esStats,
        import: esImport,
        dayglance: esDayglance,
      },
      it: {
        common: itCommon,
        onboarding: itOnboarding,
        milestone: itMilestone,
        chapter: itChapter,
        settings: itSettings,
        sync: itSync,
        timeline: itTimeline,
        search: itSearch,
        help: itHelp,
        stats: itStats,
        import: itImport,
        dayglance: itDayglance,
      },
      pt: {
        common: ptCommon,
        onboarding: ptOnboarding,
        milestone: ptMilestone,
        chapter: ptChapter,
        settings: ptSettings,
        sync: ptSync,
        timeline: ptTimeline,
        search: ptSearch,
        help: ptHelp,
        stats: ptStats,
        import: ptImport,
        dayglance: ptDayglance,
      },
      'zh-CN': {
        common: zhCNCommon,
        onboarding: zhCNOnboarding,
        milestone: zhCNMilestone,
        chapter: zhCNChapter,
        settings: zhCNSettings,
        sync: zhCNSync,
        timeline: zhCNTimeline,
        search: zhCNSearch,
        help: zhCNHelp,
        stats: zhCNStats,
        import: zhCNImport,
        dayglance: zhCNDayglance,
      },
      // Traditional Chinese (Taiwan) is served from the zh_HK translations
      // until separate zh_TW strings are needed.
      'zh-TW': {
        common: zhHKCommon,
        onboarding: zhHKOnboarding,
        milestone: zhHKMilestone,
        chapter: zhHKChapter,
        settings: zhHKSettings,
        sync: zhHKSync,
        timeline: zhHKTimeline,
        search: zhHKSearch,
        help: zhHKHelp,
        stats: zhHKStats,
        import: zhHKImport,
        dayglance: zhHKDayglance,
      },
      'zh-HK': {
        common: zhHKCommon,
        onboarding: zhHKOnboarding,
        milestone: zhHKMilestone,
        chapter: zhHKChapter,
        settings: zhHKSettings,
        sync: zhHKSync,
        timeline: zhHKTimeline,
        search: zhHKSearch,
        help: zhHKHelp,
        stats: zhHKStats,
        import: zhHKImport,
        dayglance: zhHKDayglance,
      },
    },
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
