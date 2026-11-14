// The compare view's data and axis (Lives v5.0, Phase 6a). Pure, so it is
// tested on its own. docs/lifeGLANCE-app-spec.md, "Compare / overlay view" and
// "Decided in Phase 6a".
//
// The axis is a function of the Life: x = f(time, life). v5.0 ships date
// alignment only, where every Life's offset is 0 and the axis is the calendar.
// Age alignment (v5.1) gives each Life the offset of its birth, so the same
// rendering puts "age 7" at the same x on every row; it needs only an age-tick
// generator beside getTickMarks. Nothing else here assumes calendar dates.

import { dateToX } from './timeline'
import { getMilestoneVisibility, precomputeEndpoints, filterChaptersByCategory } from './visibility'
import { isInLife, chaptersForLife } from '../data/lifeMembership'
import { ageAtDate } from './dates'

export const ALIGNMENTS = ['date']   // 'age' arrives in v5.1

const dayMs = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).getTime() : null)

/** How far a Life's row is shifted on the axis. 0 for every Life when date-aligned. */
export function lifeOffsetMs(row, alignment = 'date') {
  if (alignment === 'date') return 0
  throw new Error(`Unsupported alignment: ${alignment}`)
}

/** x for a moment on a Life's row, and the moment under an x. */
export function makeCompareAxis({ startMs, endMs, width, alignment = 'date' }) {
  return {
    alignment,
    x: (ms, row) => dateToX(ms - lifeOffsetMs(row, alignment), startMs, endMs, width),
    msAt: (x, row) => startMs + (x / width) * (endMs - startMs) + lifeOffsetMs(row, alignment),
  }
}

/**
 * One row per selected Life, in the order of `lives`. Each row holds the Life's
 * milestones and chapters after the same filters as the main timeline (category,
 * recurrence, and the chapter visibility cascade worked out with that Life's
 * own chapters), and the span its line covers:
 *   • from its birth date, or its earliest milestone or chapter without one;
 *   • to its death date, or to `nowMs`.
 * Ongoing chapters end at the death date. A milestone after the death is kept
 * (it is drawn past the end of the line).
 *
 * `milestones` have the category and recurrence filters applied already;
 * `birthDateOf(life)` gives a Life's birth date (Me's is the birthday setting).
 */
export function compareRows({ lives, selectedIds, milestones, chapters, categoryFilter = new Set(), birthDateOf, nowMs = Date.now() }) {
  const chosen = new Set(selectedIds)
  return lives.filter(l => chosen.has(l.id)).map(life => {
    const birthDate = birthDateOf(life) || null
    const deathDate = life.deathDate || null
    const lifeChapters = chaptersForLife(chapters, life.id)
    const pre = precomputeEndpoints(lifeChapters)
    const ms = milestones
      .filter(m => isInLife(m, life.id))
      .filter(m => getMilestoneVisibility(m, lifeChapters, pre, 'main').visible)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
    const deathMs = dayMs(deathDate)
    const shownChapters = filterChaptersByCategory(lifeChapters, categoryFilter)
      .map(c => (!c.end && deathDate ? { ...c, end: `${deathDate}T00:00:00.000Z` } : c))
    const earliest = Math.min(
      ...ms.map(m => new Date(m.date).getTime()),
      ...shownChapters.map(c => new Date(c.start).getTime()),
    )
    const fromMs = birthDate ? dayMs(birthDate) : (Number.isFinite(earliest) ? earliest : null)
    const toMs = deathMs ?? nowMs
    return { life, birthDate, deathDate, milestones: ms, chapters: shownChapters, fromMs, toMs, ended: deathMs !== null }
  })
}

/**
 * How old each row's Life was on `date` (YYYY-MM-DD…): { row, age } with age a
 * number, or state 'unborn' (before the birth date), 'dead' (after the death
 * date, with the age reached) or 'unknown' (no birth date).
 */
export function agesAt(date, rows) {
  const day = String(date).slice(0, 10)
  return rows.map(row => {
    if (!row.birthDate) return { row, state: 'unknown' }
    if (day < row.birthDate) return { row, state: 'unborn' }
    if (row.deathDate && day > row.deathDate) return { row, state: 'dead', age: ageAtDate(row.birthDate, row.deathDate) }
    return { row, state: 'age', age: ageAtDate(row.birthDate, day) }
  })
}

/**
 * Which milestone dots on one row get a title, and on which side of the line.
 * Labels alternate above and below; a label is dropped when it would overlap
 * the previous one on its side. `items` are { id, x } sorted by x; returns
 * id → 'above' | 'below'.
 */
export function placeLabels(items, labelWidth) {
  const out = new Map()
  const lastEnd = { above: -Infinity, below: -Infinity }
  let side = 'above'
  for (const { id, x } of items) {
    const start = x - 4
    const fits = (s) => start >= lastEnd[s]
    const pick = fits(side) ? side : fits(side === 'above' ? 'below' : 'above') ? (side === 'above' ? 'below' : 'above') : null
    if (!pick) continue
    out.set(id, pick)
    lastEnd[pick] = start + labelWidth
    side = pick === 'above' ? 'below' : 'above'
  }
  return out
}

/** Greedy lanes for a row's chapters, so overlapping ones sit on separate lines. */
export function chapterLanes(chapters, nowMs = Date.now()) {
  const ends = []
  return [...chapters].sort((a, b) => new Date(a.start) - new Date(b.start)).map(c => {
    const s = new Date(c.start).getTime()
    const e = c.end ? new Date(c.end).getTime() : nowMs
    let lane = ends.findIndex(end => end <= s)
    if (lane === -1) { lane = ends.length; ends.push(e) } else ends[lane] = e
    return { chapter: c, lane }
  })
}
