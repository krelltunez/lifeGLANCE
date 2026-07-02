import { describe, it, expect } from 'vitest'
import { filterChaptersByCategory } from './visibility.js'

// Chapter category tags + show/hide filter (issue #213).
const ch = (id, category) => ({ id, category, milestoneIds: [] })

describe('filterChaptersByCategory', () => {
  const chapters = [ch('a', 'career'), ch('b', 'travel'), ch('c', null), ch('d', 'career'), ch('e', undefined)]

  it('returns everything when no filter is active (empty set or null)', () => {
    expect(filterChaptersByCategory(chapters, new Set())).toBe(chapters)
    expect(filterChaptersByCategory(chapters, null)).toBe(chapters)
  })

  it('keeps only chapters whose tag is in the active filter', () => {
    expect(filterChaptersByCategory(chapters, new Set(['career'])).map(c => c.id)).toEqual(['a', 'd'])
  })

  it('supports multiple selected tags', () => {
    expect(filterChaptersByCategory(chapters, new Set(['career', 'travel'])).map(c => c.id)).toEqual(['a', 'b', 'd'])
  })

  it('hides untagged chapters (null or undefined category) under an active filter', () => {
    const out = filterChaptersByCategory(chapters, new Set(['travel']))
    expect(out.map(c => c.id)).toEqual(['b'])
    expect(out.some(c => c.category == null)).toBe(false)
  })
})
