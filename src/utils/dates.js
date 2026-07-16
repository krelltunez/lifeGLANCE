import {
  differenceInYears,
  differenceInMonths,
  differenceInDays,
  differenceInCalendarDays,
} from 'date-fns'
import i18n from '../i18n'
import { safeLocale } from './locale'

// Resolve the locale to use for Intl formatting. Callers may pass an explicit
// BCP-47 locale; otherwise we follow the APP's selected language (not the
// browser's), falling back to English. safeLocale guards against a malformed
// tag reaching Intl (which would throw and blank the render).
function resolveLocale(locale) {
  return safeLocale(locale || i18n.language || 'en')
}

// Returns the age (in whole years) at a given date, or null if birthday not set
// or the target date precedes the birthday.
export function ageAtDate(birthdayStr, targetDateStr) {
  if (!birthdayStr || !targetDateStr) return null
  const born   = new Date(birthdayStr)
  const target = new Date(targetDateStr)
  if (isNaN(born.getTime()) || isNaN(target.getTime())) return null
  if (target < born) return null
  return differenceInYears(target, born)
}

// Converts a UTC-midnight ISO date string to a local Date at noon on the same
// calendar date, so date-fns comparisons use the intended day regardless of
// the user's UTC offset.
function toLocalNoon(dateStr) {
  const d = new Date(dateStr)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0)
}

// Describes the relative distance from now to `dateStr` as a translation key
// plus the numbers to interpolate. Shared by relativeLabel() (plain string) and
// AnimatedRelLabel (count-up). The keys live in the `common` namespace and wrap
// each number in a positional component tag (<0>{{count}}</0>, <1>{{months}}</1>)
// so the same key serves both the string form (tags stripped) and the <Trans>
// form (tags mapped to animated components).
export function relativeParts(dateStr) {
  const date = toLocalNoon(dateStr)
  const now  = new Date()
  // Day distance in CALENDAR days so the time of day never leaks in. The
  // previous raw 24h diff against the noon-normalized date misclassified
  // around noon: before local noon, today read as "in 0 days" and yesterday
  // as "today"; late in the evening, tomorrow read as "in 0 days".
  const dayDiff = differenceInCalendarDays(date, now)
  if (dayDiff === 0) return { key: 'relToday', today: true }

  const past  = dayDiff < 0
  const days  = Math.abs(dayDiff)
  const from  = past ? date : now
  const to    = past ? now  : date
  const tense  = past ? 'Past' : 'Future'
  const years  = differenceInYears(to, from)
  const months = differenceInMonths(to, from) % 12

  if (years > 0 && months > 0) return { key: `rel${tense}YrMo`, count: years, months }
  if (years > 0)               return { key: `rel${tense}Yr`,   count: years }
  if (days > 30)               return { key: `rel${tense}Mo`,   count: Math.floor(days / 30) }
  return { key: `rel${tense}Day`, count: days }
}

export function relativeLabel(dateStr, _precision = 'day') {
  const { key, count = 0, months = 0 } = relativeParts(dateStr)
  // Strip the <0></0> / <1></1> component tags used by the animated variant.
  return i18n.t(key, { ns: 'common', count, months }).replace(/<\/?\d+>/g, '')
}

// Localized bare-duration label (no "ago"/"in" framing) such as "3 yrs, 6 mo",
// "8 mo", "5 days", or "< 1 mo". Shares the `dur*` keys in the `common`
// namespace so chapter spans and summary stats read consistently in every
// language. Pass whole years/months/days; the largest-unit pair wins.
export function formatDuration({ years = 0, months = 0, days = 0 }) {
  if (years > 0 && months > 0) return i18n.t('durYrMo', { ns: 'common', count: years, months })
  if (years > 0)               return i18n.t('durYr',   { ns: 'common', count: years })
  if (months > 0)              return i18n.t('durMo',   { ns: 'common', count: months })
  if (days > 0)                return i18n.t('durDay',  { ns: 'common', count: days })
  return i18n.t('durLessThanMonth', { ns: 'common' })
}

// Precision-aware, locale-aware date display. Intl handles field ordering,
// month names, and numbering per locale (e.g. "June 14, 2025", "14. Juni 2025",
// "2025年6月14日"). Locale defaults to the app's selected language.
export function formatDateDisplay(dateStr, precision = 'day', locale) {
  const date = toLocalNoon(dateStr)
  const loc  = resolveLocale(locale)
  if (precision === 'year')  return new Intl.DateTimeFormat(loc, { year: 'numeric' }).format(date)
  if (precision === 'month') return new Intl.DateTimeFormat(loc, { year: 'numeric', month: 'long' }).format(date)
  return new Intl.DateTimeFormat(loc, { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

// Returns the year/month/day field sequence for a locale, e.g.
// ['month','day','year'] (en-US), ['day','month','year'] (de),
// ['year','month','day'] (zh). Used to order date-input grids.
export function dateFieldOrder(locale) {
  const parts = new Intl.DateTimeFormat(resolveLocale(locale), {
    year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(2023, 0, 31)))
  return parts
    .filter(p => p.type === 'year' || p.type === 'month' || p.type === 'day')
    .map(p => p.type)
}

// Localized month names (index 0 = January). `style` is an Intl month option:
// 'long' (January), 'short' (Jan), 'narrow' (J).
export function monthNames(locale, style = 'long') {
  const fmt = new Intl.DateTimeFormat(resolveLocale(locale), { month: style, timeZone: 'UTC' })
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2023, i, 1))))
}

// Returns { years, months } elapsed/remaining for count-up animation
export function getYearsMonths(dateStr) {
  const date = toLocalNoon(dateStr)
  const now  = new Date()
  const past = date < now
  const a = past ? date : now
  const b = past ? now  : date
  return {
    years:  differenceInYears(b, a),
    months: differenceInMonths(b, a) % 12,
    days:   differenceInDays(b, a),
    past,
  }
}

export function buildDateFromParts(month, year, precision, day) {
  const y = Number(year)
  const m = Number(month) - 1
  if (precision === 'year')  return new Date(Date.UTC(y, 0, 1))
  if (precision === 'day')   return new Date(Date.UTC(y, m, Number(day) || 1))
  return new Date(Date.UTC(y, m, 15)) // month precision — use midpoint
}
