import { describe, it, expect } from 'vitest'
import { buildChapterLanes, packRows, GENERAL_LANE } from './categoryLanes.js'

const cats = [
  { id: 'career', label: 'career', color: '#4A90D9' },
  { id: 'education', label: 'education', color: '#5CAD6E' },
  { id: 'health', label: 'health', color: '#E85D75' },
]
const ch = (id, category, start, end) => ({ id, category, start, end })

describe('packRows', () => {
  it('reuses a row once the previous item has ended', () => {
    const items = [{ s: 0, e: 5 }, { s: 5, e: 8 }, { s: 3, e: 6 }]
    const rows = packRows(items, i => i.s, i => i.e).map(i => [i.s, i._row])
    expect(rows).toEqual([[0, 0], [3, 1], [5, 0]])
  })
})

describe('buildChapterLanes', () => {
  it('keeps a category in one lane however other chapters overlap it', () => {
    const chapters = [
      ch('jobA', 'career', '2014-01-01', '2020-01-01'),
      ch('uni', 'education', '2008-01-01', '2012-01-01'),
      ch('run', 'health', '2016-01-01', '2017-06-01'),
      ch('jobB', 'career', '2020-06-01', '2026-01-01'),
    ]
    const lanes = buildChapterLanes(chapters, cats)
    expect(lanes.map(l => l.id)).toEqual(['career', 'education', 'health'])
    expect(lanes[0].chapters.map(c => [c.id, c._row])).toEqual([['jobA', 0], ['jobB', 0]])
    expect(lanes[0].rows).toBe(1)
  })

  it('stacks overlapping chapters of one category inside its lane', () => {
    const lanes = buildChapterLanes([
      ch('jobA', 'career', '2014-01-01', '2020-01-01'),
      ch('freelance', 'career', '2017-01-01', '2018-06-01'),
    ], cats)
    expect(lanes[0].rows).toBe(2)
    expect(lanes[0].chapters.find(c => c.id === 'freelance')._row).toBe(1)
  })

  it('follows the category list order and skips empty categories', () => {
    const lanes = buildChapterLanes([
      ch('run', 'health', '2016-01-01', '2017-01-01'),
      ch('jobA', 'career', '2014-01-01', '2015-01-01'),
    ], cats)
    expect(lanes.map(l => l.id)).toEqual(['career', 'health'])
  })

  it('puts uncategorised and unknown-category chapters in a last general lane', () => {
    const lanes = buildChapterLanes([
      ch('berlin', null, '2020-01-01', '2024-01-01'),
      ch('old', 'deleted-cat', '2001-01-01', '2002-01-01'),
      ch('jobA', 'career', '2014-01-01', '2015-01-01'),
    ], cats)
    expect(lanes.map(l => l.id)).toEqual(['career', GENERAL_LANE])
    expect(lanes[1].label).toBeNull()
    expect(lanes[1].chapters.map(c => c.id)).toEqual(['old', 'berlin'])
  })

  it('treats an ongoing chapter as running until today', () => {
    const today = new Date('2025-01-01').getTime()
    const lanes = buildChapterLanes([
      ch('now', 'career', '2020-01-01', null),
      ch('side', 'career', '2024-01-01', '2024-06-01'),
    ], cats, today)
    expect(lanes[0].rows).toBe(2)
  })

  it('returns no lanes for no chapters', () => {
    expect(buildChapterLanes([], cats)).toEqual([])
  })
})
