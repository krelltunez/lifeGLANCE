import {
  differenceInYears,
  differenceInMonths,
  differenceInDays,
  isPast,
} from 'date-fns'
import i18n from '../i18n'

// Resolve the locale to use for Intl formatting. Callers may pass an explicit
// BCP-47 locale; otherwise we follow the APP's selected language (not the
// browser's), falling back to English.
function resolveLocale(locale) {
  return locale || i18n.language || 'en'
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

export function relativeLabel(dateStr, precision = 'day') {
  const date = toLocalNoon(dateStr)
  const now  = new Date()
  const past = isPast(date) && date < now

  if (past) {
    const years  = differenceInYears(now, date)
    const months = differenceInMonths(now, date) % 12
    const days   = differenceInDays(now, date)
    if (years > 0 && months > 0) return `${years} yr${years !== 1 ? 's' : ''}, ${months} mo ago`
    if (years > 0)               return `${years} yr${years !== 1 ? 's' : ''} ago`
    if (days > 30)               return `${Math.floor(days / 30)} mo ago`
    if (days > 0)                return `${days} day${days !== 1 ? 's' : ''} ago`
    return 'today'
  } else {
    const years  = differenceInYears(date, now)
    const months = differenceInMonths(date, now) % 12
    const days   = differenceInDays(date, now)
    if (years > 0 && months > 0) return `in ${years} yr${years !== 1 ? 's' : ''}, ${months} mo`
    if (years > 0)               return `in ${years} yr${years !== 1 ? 's' : ''}`
    if (days > 30)               return `in ${Math.floor(days / 30)} mo`
    if (days >= 0)               return `in ${days} day${days !== 1 ? 's' : ''}`
    return 'today'
  }
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
