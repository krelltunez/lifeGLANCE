import { applyRecurFilter } from './timeline'
import { precomputeEndpoints, getMilestoneVisibility } from './visibility'

// Builds a compact, render-ready snapshot of timeline state for native home-screen
// widgets (Android / iOS). The snapshot is pushed into native storage by the
// WidgetBridge plugin and read by the widget process, which cannot reach IndexedDB.
//
// Design notes:
//   - Dates are stored as raw ISO strings, never as relative labels ("in 12 days").
//     The widget computes relative labels itself at render time, because the
//     snapshot may be hours or days stale and those labels roll over at midnight.
//   - Only milestones visible on the main timeline are considered, so a widget
//     never surfaces something the user has hidden.
//   - Recurring series are collapsed to a single instance (nearest upcoming, else
//     most recent past) via applyRecurFilter('next'), so a yearly birthday doesn't
//     crowd out everything else.
//
// The shape is intentionally broad enough to also feed the planned Today and
// Current Chapter widgets without a schema change.

export const WIDGET_SNAPSHOT_VERSION = 1

// Pares a milestone down to just what a widget renders.
function projectMilestone(m) {
  if (!m) return null
  return {
    id:            m.id,
    title:         m.title,
    date:          m.date,
    datePrecision: m.date_precision ?? 'day',
    category:      m.category ?? null,
    color:         m.color ?? null,
  }
}

// Picks the active chapter for "now": started, and either ongoing (no end) or not
// yet ended. When several overlap, the one with the latest start wins (the most
// specific / innermost chapter the user is currently living in).
function pickCurrentChapter(chapters, nowMs) {
  let best = null
  for (const c of chapters) {
    const startMs = new Date(c.start).getTime()
    if (Number.isNaN(startMs) || startMs > nowMs) continue
    const endMs = c.end ? new Date(c.end).getTime() : null
    if (endMs != null && endMs < nowMs) continue
    if (!best || startMs > new Date(best.start).getTime()) best = c
  }
  return best
}

export function buildWidgetSnapshot(milestones = [], chapters = [], birthday = null, now = new Date()) {
  const nowMs = now.getTime()

  // Keep only milestones that are visible on the main timeline.
  const precomputed = precomputeEndpoints(chapters)
  const visible = milestones.filter(
    m => getMilestoneVisibility(m, chapters, precomputed, 'main').visible
  )

  // Collapse recurring series so a single instance represents each one.
  const collapsed = applyRecurFilter(visible, 'next')

  const sorted = [...collapsed].sort((a, b) => new Date(a.date) - new Date(b.date))

  let next = null   // nearest upcoming (date >= now)
  let prev = null   // most recently passed (date < now)
  let past = 0
  let future = 0
  for (const m of sorted) {
    const ms = new Date(m.date).getTime()
    if (ms >= nowMs) {
      future++
      if (!next) next = m            // sorted ascending → first future is nearest
    } else {
      past++
      prev = m                       // sorted ascending → last past is most recent
    }
  }

  const chapter = pickCurrentChapter(chapters, nowMs)
  let currentChapter = null
  if (chapter) {
    const memberDates = chapter.milestoneIds
      .map(id => milestones.find(m => m.id === id))
      .filter(Boolean)
      .map(m => new Date(m.date).getTime())
    currentChapter = {
      id:          chapter.id,
      title:       chapter.title,
      start:       chapter.start,
      end:         chapter.end ?? null,
      color:       chapter.color ?? null,
      passedCount: memberDates.filter(ms => ms < nowMs).length,
      totalCount:  memberDates.length,
    }
  }

  return {
    version:        WIDGET_SNAPSHOT_VERSION,
    generatedAt:    now.toISOString(),
    birthday:       birthday || null,
    next:           projectMilestone(next),
    prev:           projectMilestone(prev),
    currentChapter,
    counts:         { past, future, total: past + future },
  }
}
