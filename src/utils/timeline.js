export const ZOOM_LEVELS = ['decades', '30yr', 'years', 'months', 'weeks']

// Half-range in milliseconds for each named zoom level (total range = 2×)
const HALF_RANGE_MS = {
  decades: 50  * 365.25 * 24 * 3600 * 1000,
  '30yr':  30  * 365.25 * 24 * 3600 * 1000,
  years:   10  * 365.25 * 24 * 3600 * 1000,
  months:  18  *  30.44 * 24 * 3600 * 1000,
  weeks:   13  *   7    * 24 * 3600 * 1000,
}

// customHalfMs is only used when zoom === 'custom'
export function getTimeRange(zoom, centerMs, customHalfMs = 0) {
  const half = zoom === 'custom' ? customHalfMs : HALF_RANGE_MS[zoom]
  return { startMs: centerMs - half, endMs: centerMs + half }
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

// Deterministic hash → 0..1 float, stable per milestone ID
function seededRand(id) {
  let h = 0
  for (const c of String(id)) h = Math.imul(31, h) + c.charCodeAt(0) | 0
  return (h >>> 0) / 4294967295
}

// Assign above/below lanes to sorted milestones.
//   maxLane      – max lane index that fits in the container (caller computes)
//   cardTimeSpan – ms equivalent of one card width at current zoom (for overlap detection)
//
// Algorithm: each milestone has a seeded-random preferred lane (lane 1 ~30% of the time
// when space allows). If that lane has a time-proximity conflict, fall back to the first
// conflict-free lane. This gives organic spread without deterministic uniformity.
export function assignLanes(milestones, maxLane = 0, cardTimeSpan = 0) {
  const sorted = [...milestones].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  )

  const placed = { above: [], below: [] }

  return sorted.map((m, i) => {
    const above = i % 2 === 0
    const side  = above ? 'above' : 'below'
    const mMs   = new Date(m.date).getTime()

    const hasConflict = (l) =>
      cardTimeSpan > 0 &&
      placed[side].some(p => p.lane === l && Math.abs(p.ms - mMs) < cardTimeSpan)

    // Seeded random: ~30% of milestones prefer lane 1 for visual variety
    const rand       = seededRand(m.id)
    const preferLane = (maxLane >= 1 && rand < 0.30) ? 1 : 0

    let lane = preferLane
    if (hasConflict(lane)) {
      // Scan upward from 0 for first free lane
      lane = 0
      while (lane < maxLane && hasConflict(lane)) lane++
      // If still conflicting at maxLane, accept it (unavoidable dense cluster)
    }

    placed[side].push({ ms: mMs, lane })
    return { ...m, above, lane }
  })
}
