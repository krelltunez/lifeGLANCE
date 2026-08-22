import { describe, it, expect } from 'vitest'
import { buildSpotlightIndex } from './spotlightIndex'

// Minimal milestone factory — only the fields the index builder reads.
function ms(over = {}) {
  return {
    id:                     over.id ?? Math.random().toString(36).slice(2),
    title:                  'untitled',
    date:                   '2026-01-01T00:00:00Z',
    date_precision:         'day',
    category:               'personal',
    note:                   '',
    mainTimelineVisibility: 'inherit',
    recurrence_id:          null,
    ...over,
  }
}

describe('buildSpotlightIndex', () => {
  it('emits one { id, title, desc } entry per milestone', () => {
    const items = buildSpotlightIndex([
      ms({ id: 'a', title: 'Graduated', date: '2019-06-12T00:00:00Z' }),
    ], [], 'en-US')
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('a')
    expect(items[0].title).toBe('Graduated')
    expect(items[0].desc).toBe('June 12, 2019')
  })

  it('formats the date at the milestone precision', () => {
    const [year, month, day] = buildSpotlightIndex([
      ms({ id: 'y', date: '2019-06-12T00:00:00Z', date_precision: 'year' }),
      ms({ id: 'm', date: '2019-06-12T00:00:00Z', date_precision: 'month' }),
      ms({ id: 'd', date: '2019-06-12T00:00:00Z', date_precision: 'day' }),
    ], [], 'en-US')
    expect(year.desc).toBe('2019')
    expect(month.desc).toBe('June 2019')
    expect(day.desc).toBe('June 12, 2019')
  })

  it('appends a whitespace-collapsed, truncated note excerpt', () => {
    const [short, long] = buildSpotlightIndex([
      ms({ id: 's', date_precision: 'year', date: '2020-01-01T00:00:00Z', note: 'a  quick\n note' }),
      ms({ id: 'l', date_precision: 'year', date: '2020-01-01T00:00:00Z', note: 'x'.repeat(500) }),
    ], [], 'en-US')
    expect(short.desc).toBe('2020 · a quick note')
    expect(long.desc.length).toBeLessThan(200)
    expect(long.desc.endsWith('…')).toBe(true)
  })

  it('never indexes milestones hidden from the main timeline', () => {
    const items = buildSpotlightIndex([
      ms({ id: 'shown' }),
      ms({ id: 'hidden', mainTimelineVisibility: 'hidden' }),
    ], [])
    expect(items.map(i => i.id)).toEqual(['shown'])
  })

  it('collapses a recurring series to a single entry', () => {
    const items = buildSpotlightIndex([
      ms({ id: 'r1', title: 'Birthday', recurrence_id: 'series', date: '2025-03-01T00:00:00Z' }),
      ms({ id: 'r2', title: 'Birthday', recurrence_id: 'series', date: '2026-03-01T00:00:00Z' }),
      ms({ id: 'r3', title: 'Birthday', recurrence_id: 'series', date: '2027-03-01T00:00:00Z' }),
    ], [])
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Birthday')
  })

  it('skips entries without an id or title rather than emitting junk', () => {
    const items = buildSpotlightIndex([
      ms({ id: 'ok', title: 'Fine' }),
      ms({ id: '', title: 'No id' }),
      ms({ id: 'no-title', title: '' }),
    ], [])
    expect(items.map(i => i.id)).toEqual(['ok'])
  })
})
