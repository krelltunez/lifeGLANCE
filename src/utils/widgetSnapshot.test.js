import { describe, it, expect } from 'vitest'
import { buildWidgetSnapshot, WIDGET_SNAPSHOT_VERSION } from './widgetSnapshot'

const NOW = new Date('2026-06-20T12:00:00Z')

// Minimal milestone factory — only the fields the snapshot builder reads.
function ms(over = {}) {
  return {
    id:                     over.id ?? Math.random().toString(36).slice(2),
    title:                  'untitled',
    date:                   '2026-01-01T00:00:00Z',
    date_precision:         'day',
    category:               'personal',
    color:                  '#9370DB',
    mainTimelineVisibility: 'inherit',
    recurrence_id:          null,
    ...over,
  }
}

describe('buildWidgetSnapshot', () => {
  it('stamps version and generatedAt, and an empty timeline yields nulls', () => {
    const snap = buildWidgetSnapshot([], [], null, NOW)
    expect(snap.version).toBe(WIDGET_SNAPSHOT_VERSION)
    expect(snap.generatedAt).toBe(NOW.toISOString())
    expect(snap.next).toBeNull()
    expect(snap.prev).toBeNull()
    expect(snap.currentChapter).toBeNull()
    expect(snap.counts).toEqual({ past: 0, future: 0, total: 0 })
  })

  it('picks the nearest upcoming as next and most recent past as prev', () => {
    const milestones = [
      ms({ id: 'far-past',   title: 'Far past',   date: '2020-01-01T00:00:00Z' }),
      ms({ id: 'recent',     title: 'Recent',     date: '2026-06-01T00:00:00Z' }),
      ms({ id: 'soon',       title: 'Soon',       date: '2026-07-01T00:00:00Z' }),
      ms({ id: 'far-future', title: 'Far future', date: '2030-01-01T00:00:00Z' }),
    ]
    const snap = buildWidgetSnapshot(milestones, [], null, NOW)
    expect(snap.next.id).toBe('soon')
    expect(snap.prev.id).toBe('recent')
    expect(snap.counts).toEqual({ past: 2, future: 2, total: 4 })
  })

  it('projects a milestone down to widget-relevant fields only', () => {
    const milestones = [ms({ id: 'a', title: 'Trip', date: '2026-07-01T00:00:00Z', category: 'travel', color: '#C8A96E' })]
    const snap = buildWidgetSnapshot(milestones, [], null, NOW)
    expect(snap.next).toEqual({
      id: 'a', title: 'Trip', date: '2026-07-01T00:00:00Z',
      datePrecision: 'day', category: 'travel', color: '#C8A96E',
    })
  })

  it('excludes milestones hidden from the main timeline', () => {
    const milestones = [
      ms({ id: 'hidden', title: 'Hidden', date: '2026-07-01T00:00:00Z', mainTimelineVisibility: 'hidden' }),
      ms({ id: 'shown',  title: 'Shown',  date: '2026-08-01T00:00:00Z', mainTimelineVisibility: 'shown' }),
    ]
    const snap = buildWidgetSnapshot(milestones, [], null, NOW)
    expect(snap.next.id).toBe('shown')
    expect(snap.counts.future).toBe(1)
  })

  it('collapses a recurring series to a single upcoming instance', () => {
    const milestones = [
      ms({ id: 'b-2025', title: 'Birthday', date: '2025-09-01T00:00:00Z', recurrence_id: 'bday' }),
      ms({ id: 'b-2026', title: 'Birthday', date: '2026-09-01T00:00:00Z', recurrence_id: 'bday' }),
      ms({ id: 'b-2027', title: 'Birthday', date: '2027-09-01T00:00:00Z', recurrence_id: 'bday' }),
    ]
    const snap = buildWidgetSnapshot(milestones, [], null, NOW)
    expect(snap.next.id).toBe('b-2026')
    expect(snap.counts.future).toBe(1)
    expect(snap.counts.past).toBe(0)
  })

  it('resolves the current chapter with passed/total member counts', () => {
    const milestones = [
      ms({ id: 'm1', date: '2024-02-01T00:00:00Z' }),  // passed
      ms({ id: 'm2', date: '2026-03-01T00:00:00Z' }),  // passed
      ms({ id: 'm3', date: '2027-01-01T00:00:00Z' }),  // upcoming
    ]
    const chapters = [{
      id: 'ch', title: 'University', start: '2024-01-01T00:00:00Z', end: '2028-01-01T00:00:00Z',
      color: '#4A90D9', milestoneIds: ['m1', 'm2', 'm3'], defaultMemberVisibility: 'shown',
    }]
    const snap = buildWidgetSnapshot(milestones, chapters, null, NOW)
    expect(snap.currentChapter).toMatchObject({ id: 'ch', title: 'University', passedCount: 2, totalCount: 3 })
  })

  it('treats an ongoing chapter (no end) as current and prefers the innermost', () => {
    const chapters = [
      { id: 'outer', title: 'Adulthood', start: '2010-01-01T00:00:00Z', end: null, color: '#fff', milestoneIds: [] },
      { id: 'inner', title: 'New job',   start: '2026-01-01T00:00:00Z', end: null, color: '#fff', milestoneIds: [] },
    ]
    const snap = buildWidgetSnapshot([], chapters, null, NOW)
    expect(snap.currentChapter.id).toBe('inner')
  })

  it('ignores chapters that have not started or have already ended', () => {
    const chapters = [
      { id: 'over',   title: 'Childhood', start: '1990-01-01T00:00:00Z', end: '2008-01-01T00:00:00Z', color: '#fff', milestoneIds: [] },
      { id: 'future', title: 'Retirement', start: '2050-01-01T00:00:00Z', end: null, color: '#fff', milestoneIds: [] },
    ]
    const snap = buildWidgetSnapshot([], chapters, null, NOW)
    expect(snap.currentChapter).toBeNull()
  })

  it('passes through the birthday when set', () => {
    expect(buildWidgetSnapshot([], [], '1990-05-01', NOW).birthday).toBe('1990-05-01')
    expect(buildWidgetSnapshot([], [], '', NOW).birthday).toBeNull()
  })
})
