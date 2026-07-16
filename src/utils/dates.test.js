import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import {
  buildDateFromParts,
  formatDateDisplay,
  dateFieldOrder,
  monthNames,
  relativeParts,
  relativeLabel,
  formatDuration,
} from './dates'
import i18n from '../i18n'

function isoDaysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

describe('buildDateFromParts', () => {
  describe('day precision', () => {
    it('returns exact date', () => {
      const d = buildDateFromParts('3', '2020', 'day', '15')
      expect(d).toEqual(new Date(Date.UTC(2020, 2, 15)))
    })

    it('defaults to day 1 when day is empty', () => {
      const d = buildDateFromParts('6', '2021', 'day', '')
      expect(d).toEqual(new Date(Date.UTC(2021, 5, 1)))
    })

    it('handles Dec 31', () => {
      const d = buildDateFromParts('12', '2023', 'day', '31')
      expect(d).toEqual(new Date(Date.UTC(2023, 11, 31)))
    })

    it('handles Feb 29 in a leap year', () => {
      const d = buildDateFromParts('2', '2024', 'day', '29')
      expect(d).toEqual(new Date(Date.UTC(2024, 1, 29)))
    })
  })

  describe('month precision', () => {
    it('returns the 15th of the month', () => {
      const d = buildDateFromParts('8', '2019', 'month', '')
      expect(d).toEqual(new Date(Date.UTC(2019, 7, 15)))
    })

    it('returns midpoint regardless of day argument', () => {
      const d1 = buildDateFromParts('1', '2020', 'month', '1')
      const d2 = buildDateFromParts('1', '2020', 'month', '31')
      expect(d1).toEqual(new Date(Date.UTC(2020, 0, 15)))
      expect(d2).toEqual(new Date(Date.UTC(2020, 0, 15)))
    })
  })

  describe('year precision', () => {
    it('returns Jan 1 of the given year', () => {
      const d = buildDateFromParts('6', '1999', 'year', '15')
      expect(d).toEqual(new Date(Date.UTC(1999, 0, 1)))
    })

    it('ignores month and day arguments', () => {
      const d = buildDateFromParts('12', '2050', 'year', '31')
      expect(d).toEqual(new Date(Date.UTC(2050, 0, 1)))
    })
  })
})

describe('formatDateDisplay', () => {
  const DATE = '2025-06-14'

  it('formats full dates in en-US order (month, day, year)', () => {
    expect(formatDateDisplay(DATE, 'day', 'en-US')).toBe('June 14, 2025')
  })

  it('formats month precision without the day', () => {
    expect(formatDateDisplay(DATE, 'month', 'en-US')).toBe('June 2025')
  })

  it('formats year precision as the year alone', () => {
    expect(formatDateDisplay(DATE, 'year', 'en-US')).toBe('2025')
  })

  it('follows the German field order and month names', () => {
    expect(formatDateDisplay(DATE, 'day', 'de')).toBe('14. Juni 2025')
  })

  it('uses East-Asian year-first formatting for Chinese', () => {
    expect(formatDateDisplay(DATE, 'day', 'zh-CN')).toBe('2025年6月14日')
  })
})

describe('dateFieldOrder', () => {
  it('returns month/day/year for en-US', () => {
    expect(dateFieldOrder('en-US')).toEqual(['month', 'day', 'year'])
  })

  it('returns day/month/year for day-first locales', () => {
    expect(dateFieldOrder('de')).toEqual(['day', 'month', 'year'])
    expect(dateFieldOrder('en-GB')).toEqual(['day', 'month', 'year'])
  })

  it('returns year/month/day for East-Asian locales', () => {
    expect(dateFieldOrder('zh-CN')).toEqual(['year', 'month', 'day'])
  })
})

describe('monthNames', () => {
  it('returns 12 localized long month names indexed from January', () => {
    const en = monthNames('en-US', 'long')
    expect(en).toHaveLength(12)
    expect(en[0]).toBe('January')
    expect(en[11]).toBe('December')
  })

  it('supports short month names', () => {
    expect(monthNames('en-US', 'short')[0]).toBe('Jan')
  })

  it('localizes month names', () => {
    expect(monthNames('de', 'long')[0]).toBe('Januar')
  })
})

describe('relativeParts', () => {
  it('returns the today key for the current date', () => {
    expect(relativeParts(isoDaysFromNow(0))).toEqual({ key: 'relToday', today: true })
  })

  // Day classification must not depend on the time of day (the raw 24h diff
  // against noon-normalized dates used to call today "in 0 days" before local
  // noon and tomorrow "in 0 days" late in the evening).
  describe('around day boundaries', () => {
    afterEach(() => vi.useRealTimers())

    // Local calendar date string for `offset` days from the (mocked) now.
    function isoLocal(offset = 0) {
      const d = new Date()
      d.setDate(d.getDate() + offset)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    for (const hour of [0, 9, 12, 23]) {
      it(`classifies correctly at ${String(hour).padStart(2, '0')}:30 local`, () => {
        vi.useFakeTimers({ now: new Date(2026, 6, 16, hour, 30, 0) })
        expect(relativeParts(isoLocal(0))).toEqual({ key: 'relToday', today: true })
        expect(relativeParts(isoLocal(1))).toEqual({ key: 'relFutureDay', count: 1 })
        expect(relativeParts(isoLocal(-1))).toEqual({ key: 'relPastDay', count: 1 })
      })
    }
  })

  it('uses past day keys for recent past dates', () => {
    const p = relativeParts(isoDaysFromNow(-7))
    expect(p.key).toBe('relPastDay')
    expect(p.count).toBeGreaterThanOrEqual(6)
    expect(p.count).toBeLessThanOrEqual(7)
  })

  it('uses future day keys for near-future dates', () => {
    const p = relativeParts(isoDaysFromNow(5))
    expect(p.key).toBe('relFutureDay')
    expect(p.count).toBeGreaterThanOrEqual(4)
    expect(p.count).toBeLessThanOrEqual(5)
  })

  it('uses month keys past the 30-day threshold', () => {
    expect(relativeParts(isoDaysFromNow(-90)).key).toBe('relPastMo')
    expect(relativeParts(isoDaysFromNow(120)).key).toBe('relFutureMo')
  })
})

describe('relativeLabel', () => {
  beforeAll(async () => { await i18n.changeLanguage('en') })

  it('renders the localized today string', () => {
    expect(relativeLabel(isoDaysFromNow(0))).toBe('today')
  })

  it('renders past/future day phrases with the count interpolated', () => {
    expect(relativeLabel(isoDaysFromNow(-7))).toMatch(/^\d+ days? ago$/)
    expect(relativeLabel(isoDaysFromNow(5))).toMatch(/^in \d+ days?$/)
  })

  it('strips the positional component tags', () => {
    const label = relativeLabel(isoDaysFromNow(-400))
    expect(label).not.toContain('<')
    expect(label).not.toContain('{{')
  })

  it('follows the selected app language', async () => {
    await i18n.changeLanguage('de')
    const label = relativeLabel(isoDaysFromNow(-7))
    expect(label).toContain('vor')
    expect(label).toContain('Tag')
    await i18n.changeLanguage('en')
  })
})

describe('formatDuration', () => {
  beforeAll(async () => { await i18n.changeLanguage('en') })

  it('formats a year + month span', () => {
    expect(formatDuration({ years: 3, months: 6 })).toBe('3 yrs, 6 mo')
  })

  it('uses the singular form for a single year', () => {
    expect(formatDuration({ years: 1 })).toBe('1 yr')
  })

  it('formats months only', () => {
    expect(formatDuration({ months: 8 })).toBe('8 mo')
  })

  it('formats days only', () => {
    expect(formatDuration({ days: 5 })).toBe('5 days')
  })

  it('falls back to a sub-month label when every unit is zero', () => {
    expect(formatDuration({})).toBe('< 1 mo')
  })

  it('follows the selected app language', async () => {
    await i18n.changeLanguage('zh-CN')
    expect(formatDuration({ years: 3, months: 6 })).toBe('3年6个月')
    await i18n.changeLanguage('en')
  })
})
