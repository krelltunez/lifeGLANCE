export const ZOOM_LEVELS = ['decades', '30yr', 'years', 'months', 'weeks']

// Half-range in milliseconds for each named zoom level (total range = 2×)
const HALF_RANGE_MS = {
  decades: 50  * 365.25 * 24 * 3600 * 1000,
  '30yr':  30  * 365.25 * 24 * 3600 * 1000,
  years:   10  * 365.25 * 24 * 3600 * 1000,
  months:  18  *  30.44 * 24 * 3600 * 1000,
  weeks:   13  *   7    * 24 * 3600 * 1000,
}

// Where today sits on screen for each view mode (0 = left edge, 1 = right edge)
const VIEW_ANCHOR = { all: 0.5, past: 0.88, future: 0.12 }

// customHalfMs is only used when zoom === 'custom'
export function getTimeRange(zoom, centerMs, customHalfMs = 0) {
  const half = zoom === 'custom' ? customHalfMs : HALF_RANGE_MS[zoom]
  return { startMs: centerMs - half, endMs: centerMs + half }
}

// Like getTimeRange but today (anchorMs) is placed at VIEW_ANCHOR[viewMode]
// instead of always at the center. All three modes produce the same total span.
export function getTimeRangeForView(zoom, anchorMs, viewMode = 'all', customHalfMs = 0) {
  const half     = zoom === 'custom' ? customHalfMs : HALF_RANGE_MS[zoom]
  const span     = half * 2
  const fraction = VIEW_ANCHOR[viewMode] ?? 0.5
  const startMs  = anchorMs - fraction * span
  return { startMs, endMs: startMs + span }
}

export function dateToX(dateMs, startMs, endMs, width) {
  const span = endMs - startMs
  if (span === 0) return width / 2
  return ((dateMs - startMs) / span) * width
}

export function xToMs(x, startMs, endMs, width) {
  return startMs + (x / width) * (endMs - startMs)
}

export function getMsPerPx(zoom, width, customHalfMs = 0) {
  const half = zoom === 'custom' ? customHalfMs : HALF_RANGE_MS[zoom]
  return (half * 2) / width
}

// Pick the best tick-mark visual style for a given span
function autoStyle(startMs, endMs) {
  const spanYears = (endMs - startMs) / (365.25 * 24 * 3600 * 1000)
  if (spanYears > 15)  return 'decades'
  if (spanYears > 2)   return 'years'
  if (spanYears > 0.4) return 'months'
  return 'weeks'
}

// Generate tick marks for the current view
export function getTickMarks(zoom, startMs, endMs, width) {
  // 'custom' auto-selects its visual style; '30yr' uses the same style as 'decades'
  const style = zoom === 'custom' ? autoStyle(startMs, endMs)
              : zoom === '30yr'   ? 'decades'
              : zoom

  const ticks     = []
  const startDate = new Date(startMs)
  const endDate   = new Date(endMs)

  if (style === 'decades') {
    const startYear = Math.floor(startDate.getFullYear() / 10) * 10
    for (let y = startYear; y <= endDate.getFullYear(); y++) {
      const x = dateToX(new Date(y, 0, 1).getTime(), startMs, endMs, width)
      if (x < -2 || x > width + 2) continue
      const major = y % 10 === 0
      ticks.push({ x, label: major ? String(y) : (y % 5 === 0 ? String(y) : ''), major })
    }
  } else if (style === 'years') {
    for (let y = startDate.getFullYear(); y <= endDate.getFullYear(); y++) {
      const x = dateToX(new Date(y, 0, 1).getTime(), startMs, endMs, width)
      if (x < -2 || x > width + 2) continue
      ticks.push({ x, label: String(y), major: true })
    }
  } else if (style === 'months') {
    let d = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
    while (d <= endDate) {
      const x = dateToX(d.getTime(), startMs, endMs, width)
      if (x >= -2 && x <= width + 2) {
        const major = d.getMonth() === 0
        const label = major
          ? String(d.getFullYear())
          : d.toLocaleString('default', { month: 'short' })
        ticks.push({ x, label, major })
      }
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    }
  } else if (style === 'weeks') {
    let d = new Date(startDate)
    d.setDate(d.getDate() - d.getDay()) // align to Sunday
    while (d <= endDate) {
      const x = dateToX(d.getTime(), startMs, endMs, width)
      if (x >= -2 && x <= width + 2) {
        const isFirst = d.getDate() <= 7
        const label = isFirst
          ? d.toLocaleString('default', { month: 'short', year: 'numeric' })
          : ''
        ticks.push({ x, label, major: isFirst })
      }
      d = new Date(d.getTime() + 7 * 24 * 3600 * 1000)
    }
  }

  return ticks
}

// Deterministic hash of an arbitrary string → 0..1 float
function seededHash(str) {
  let h = 0
  for (const c of str) h = Math.imul(31, h) + c.charCodeAt(0) | 0
  return (h >>> 0) / 4294967295
}

// Filter recurring milestones according to the selected recurrence display mode.
//   all    — show everything
//   past   — non-recurring + recurring instances that are in the past
//   future — non-recurring + recurring instances that are in the future
//   next   — non-recurring + one instance per series (nearest upcoming, or most recent past)
export function applyRecurFilter(ms, mode) {
  if (mode === 'all') return ms
  const now    = new Date()
  const nonRec = ms.filter(m => !m.recurrence_id)
  const rec    = ms.filter(m =>  m.recurrence_id)
  if (mode === 'past')   return [...nonRec, ...rec.filter(m => new Date(m.date) <  now)]
  if (mode === 'future') return [...nonRec, ...rec.filter(m => new Date(m.date) >= now)]
  // 'next': one instance per series
  const byId = {}
  for (const m of rec) { (byId[m.recurrence_id] ??= []).push(m) }
  const picked = Object.values(byId).map(arr => {
    const up = arr.filter(m => new Date(m.date) >= now).sort((a, b) => new Date(a.date) - new Date(b.date))
    return up.length ? up[0] : arr.sort((a, b) => new Date(b.date) - new Date(a.date))[0]
  })
  return [...nonRec, ...picked]
}

// Assign above/below lanes to sorted milestones using a force-directed simulation.
//   maxLane      – max lane index that fits in the container (caller computes)
//   cardTimeSpan – ms equivalent of one card width at current zoom (for overlap detection)
//
// Each card starts at lane 0, then repulsion forces from temporally-close neighbours
// push overlapping cards apart while a centering force pulls every card back toward
// lane 0. After the simulation the fractional lane is snapped to the nearest integer.
//
// connRand (independent seeded hash) drives connector-length jitter in the renderer.
export function assignLanes(milestones, maxLane = 0, cardTimeSpan = 0, forceAbove = false) {
  const sorted = [...milestones].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  )

  // Split into above/below groups and simulate each independently
  const groups = { above: [], below: [] }
  sorted.forEach((m, i) => {
    const above = forceAbove || i % 2 === 0
    const connRand = seededHash(String(m.id) + '~conn')
    groups[above ? 'above' : 'below'].push({
      m, above, connRand,
      ms: new Date(m.date).getTime(),
      pos: 0,   // fractional lane position
      vel: 0,
    })
  })

  const K_CENTER  = 0.2   // pull toward lane 0
  const K_REPEL   = 1.2   // push apart overlapping cards
  const DAMPING   = 0.75
  const ITERATIONS = 60

  for (const cards of Object.values(groups)) {
    if (cards.length === 0) continue
    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (let i = 0; i < cards.length; i++) {
        const ci = cards[i]
        let force = -K_CENTER * ci.pos  // centering: always pulls toward 0

        if (cardTimeSpan > 0) {
          for (let j = 0; j < cards.length; j++) {
            if (i === j) continue
            const cj = cards[j]
            if (Math.abs(ci.ms - cj.ms) >= cardTimeSpan) continue
            // Temporal overlap — repel in lane space
            const delta = ci.pos - cj.pos
            const dist  = Math.abs(delta)
            // Full repulsion within 1 lane, tapers off beyond
            if (dist < 1.5) {
              const sign = delta >= 0 ? 1 : -1
              force += sign * K_REPEL * (1.5 - dist) / 1.5
            }
          }
        }

        ci.vel = (ci.vel + force) * DAMPING
      }
      // Apply velocities
      for (const c of cards) c.pos += c.vel
      // Clamp to valid lane range
      for (const c of cards) c.pos = Math.max(0, Math.min(maxLane, c.pos))
    }
  }

  // Snap fractional positions to integer lanes and attach to milestones
  const result = []
  for (const cards of Object.values(groups)) {
    for (const c of cards) {
      const lane = Math.min(maxLane, Math.max(0, Math.round(c.pos)))
      result.push({ ...c.m, above: c.above, lane, connRand: c.connRand })
    }
  }

  // Restore original date-sorted order so the caller's rendering is stable
  result.sort((a, b) => new Date(a.date) - new Date(b.date))
  return result
}
