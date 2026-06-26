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

// Color pin slots. Each can hold one milestone (set in the app); each has its own
// dedicated home-screen widget, so several pinned countdowns can coexist without
// per-widget configuration. Keep in sync with the native widgets and the pin UI.
export const PIN_SLOTS = ['amber', 'rose', 'teal', 'blue']

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

export function buildWidgetSnapshot(milestones = [], chapters = [], birthday = null, now = new Date(), pins = {}) {
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

  // Candidate pool for the "On This Day" widget: every past, dated (non-year-precision)
  // milestone, most-recent first. The widget filters this down to today's month/day at
  // RENDER time, so it stays correct across midnight (when the widget re-renders) without
  // the app having to re-push the snapshot.
  const onThisDay = visible
    .filter(m => m.date_precision !== 'year' && new Date(m.date) < now)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(projectMilestone)

  // Milestones dated within the current calendar year (for the stats widget).
  const thisYear = now.getFullYear()
  const thisYearCount = visible.filter(m => new Date(m.date).getFullYear() === thisYear).length

  // Resolve each color pin slot (slot → milestone id, set in the app) to its milestone.
  // Only set+found slots are included — unset slots are omitted, not stored as null, so
  // the iOS [String: Milestone] decode never sees a null value. Pinned milestones show
  // regardless of timeline visibility (the pin is explicit).
  const resolvedPins = {}
  for (const slot of PIN_SLOTS) {
    const id = pins?.[slot]
    const m = id ? milestones.find(x => x.id === id) : null
    if (m) resolvedPins[slot] = projectMilestone(m)
  }

  return {
    version:        WIDGET_SNAPSHOT_VERSION,
    generatedAt:    now.toISOString(),
    birthday:       birthday || null,
    next:           projectMilestone(next),
    prev:           projectMilestone(prev),
    currentChapter,
    onThisDay,
    pins:           resolvedPins,
    counts:         { past, future, total: past + future, thisYear: thisYearCount },
  }
}
