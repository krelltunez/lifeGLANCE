import {
  differenceInYears,
  differenceInMonths,
  differenceInDays,
  format,
  isPast,
} from 'date-fns'

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

export function relativeLabel(dateStr, precision = 'day') {
  const date = new Date(dateStr)
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

export function formatDateDisplay(dateStr, precision = 'day') {
  const date = new Date(dateStr)
  if (precision === 'year')  return format(date, 'yyyy')
  if (precision === 'month') return format(date, 'MMMM yyyy')
  return format(date, 'MMMM d, yyyy')
}

// Returns { years, months } elapsed/remaining for count-up animation
export function getYearsMonths(dateStr) {
  const date = new Date(dateStr)
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
