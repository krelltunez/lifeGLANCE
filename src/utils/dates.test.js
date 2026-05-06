import { describe, it, expect } from 'vitest'
import { buildDateFromParts } from './dates'

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
