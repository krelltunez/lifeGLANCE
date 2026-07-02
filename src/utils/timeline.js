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

// Pinch-to-zoom bounds, expressed as half-span in ms: ~1 month visible at max
// zoom-in, ~300 years visible at max zoom-out.
export const PINCH_MIN_HALF_MS = 14  * 24 * 3600 * 1000
export const PINCH_MAX_HALF_MS = 150 * 365.25 * 24 * 3600 * 1000

// Given the view state captured at the start of a pinch gesture and the live
// finger geometry, compute the new half-span and pan offset. `distRatio` is the
// current finger distance over the distance at gesture start (>1 = fingers
// spreading = zoom in). The timestamp under the starting midpoint is kept under
// the current midpoint, so content follows the fingers (two-finger pan + zoom
// combined). `nowMs` cancels out, so this is pure and unit-testable.
export function computePinchZoom({
  startHalfMs, startPanMs, viewMode = 'all', width,
  startMidX, midX, distRatio,
  minHalfMs = PINCH_MIN_HALF_MS, maxHalfMs = PINCH_MAX_HALF_MS,
}) {
  const fraction = VIEW_ANCHOR[viewMode] ?? 0.5
  const half     = Math.max(minHalfMs, Math.min(maxHalfMs, startHalfMs / distRatio))
  const kStart   = startMidX / width - fraction
  const kCur     = midX / width - fraction
  const panMs    = startPanMs + startHalfMs * 2 * kStart - half * 2 * kCur
  return { halfMs: half, panMs }
}

// Pick the best tick-mark visual style for a given span
function autoStyle(startMs, endMs) {
  const spanYears = (endMs - startMs) / (365.25 * 24 * 3600 * 1000)
  if (spanYears > 15)  return 'decades'
  if (spanYears > 2)   return 'years'
  if (spanYears > 0.4) return 'months'
  return 'weeks'
}

// Generate tick marks for the current view. `locale` (BCP-47) localizes the
// short month labels; callers pass the app's selected language.
export function getTickMarks(zoom, startMs, endMs, width, locale) {
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
          : d.toLocaleString(locale, { month: 'short' })
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
          ? d.toLocaleString(locale, { month: 'short', year: 'numeric' })
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

// Assign above/below lanes to sorted milestones.
//   maxLane      – max lane index that fits in the container (caller computes)
//   cardTimeSpan – ms equivalent of one card width at current zoom (for overlap detection)
//
// Uses force-directed simulation when cards are sparse enough for it to converge
// cleanly (avg neighbours < DENSITY_THRESHOLD). Falls back to greedy interval
// packing when nearly every card overlaps every other (e.g. 30yr zoom), where
// force-directed produces worse results than a simple sequential scan.
//
// connRand (independent seeded hash) drives connector-length jitter in the renderer.
export function assignLanes(milestones, maxLane = 0, cardTimeSpan = 0, forceAbove = false) {
  const sorted = [...milestones].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  )

  // Build per-card metadata shared by both algorithms
  const cards = sorted.map((m, i) => ({
    m,
    above: forceAbove || i % 2 === 0,
    connRand: seededHash(String(m.id) + '~conn'),
    ms: new Date(m.date).getTime(),
  }))

  // Measure average temporal-neighbour count to choose algorithm
  const DENSITY_THRESHOLD = 3  // avg neighbours per card before switching to greedy
  let totalNeighbours = 0
  if (cardTimeSpan > 0 && cards.length > 1) {
    for (let i = 0; i < cards.length; i++)
      for (let j = 0; j < cards.length; j++)
        if (i !== j && Math.abs(cards[i].ms - cards[j].ms) < cardTimeSpan)
          totalNeighbours++
  }
  const avgNeighbours = cards.length > 0 ? totalNeighbours / cards.length : 0
  const useForceSim   = avgNeighbours < DENSITY_THRESHOLD

  // ── Force-directed simulation (sparse views) ──────────────────────────────
  if (useForceSim) {
    const groups = { above: [], below: [] }
    cards.forEach((c, i) => {
      groups[c.above ? 'above' : 'below'].push({ ...c, idx: i, pos: 0, vel: 0 })
    })

    const K_CENTER  = 0.2
    const K_REPEL   = 1.2
    const DAMPING   = 0.75
    const ITERATIONS = 60

    for (const group of Object.values(groups)) {
      if (group.length === 0) continue
      for (let iter = 0; iter < ITERATIONS; iter++) {
        for (let i = 0; i < group.length; i++) {
          const ci = group[i]
          let force = -K_CENTER * ci.pos
          if (cardTimeSpan > 0) {
            for (let j = 0; j < group.length; j++) {
              if (i === j) continue
              const cj = group[j]
              if (Math.abs(ci.ms - cj.ms) >= cardTimeSpan) continue
              const delta = ci.pos - cj.pos
              const dist  = Math.abs(delta)
              if (dist < 1.5) {
                const sign = dist > 0.001 ? (delta > 0 ? 1 : -1) : (i > j ? 1 : -1)
                force += sign * K_REPEL * (1.5 - dist) / 1.5
              }
            }
          }
          ci.vel = (ci.vel + force) * DAMPING
        }
        for (const c of group) c.pos = Math.max(0, Math.min(maxLane, c.pos + c.vel))
      }
    }

    const result = []
    for (const group of Object.values(groups))
      for (const c of group)
        result.push({ ...c.m, above: c.above, lane: Math.round(Math.max(0, Math.min(maxLane, c.pos))), connRand: c.connRand })
    result.sort((a, b) => new Date(a.date) - new Date(b.date))
    return result
  }

  // ── Greedy interval packing (dense views) ─────────────────────────────────
  const placed = { above: [], below: [] }
  return cards.map(({ m, above, connRand, ms }) => {
    const side = above ? 'above' : 'below'
    const hasConflict = (l) =>
      cardTimeSpan > 0 &&
      placed[side].some(p => p.lane === l && Math.abs(p.ms - ms) < cardTimeSpan)
    let lane = 0
    while (lane < maxLane && hasConflict(lane)) lane++
    placed[side].push({ ms, lane })
    return { ...m, above, lane, connRand }
  })
}


