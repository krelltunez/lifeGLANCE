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

// Assign above/below lanes to sorted milestones.
//   maxLane      – max lane index that fits in the container (caller computes)
//   cardTimeSpan – ms equivalent of one card width at current zoom (for overlap detection)
//
// Algorithm: greedy by time proximity. For each milestone try lane 0; only bump
// to a higher lane if another card on the same side is within one card-width of
// time. This means sparse milestones always stay at lane 0 regardless of sort
// order, and only genuinely clustered milestones spread outward.
export function assignLanes(milestones, maxLane = 0, cardTimeSpan = 0) {
  const sorted = [...milestones].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  )

  // Track placed cards per side: [{ ms, lane }]
  const placed = { above: [], below: [] }

  return sorted.map((m, i) => {
    const above = i % 2 === 0
    const side  = above ? 'above' : 'below'
    const mMs   = new Date(m.date).getTime()

    let lane = 0
    if (cardTimeSpan > 0) {
      while (lane < maxLane) {
        const conflict = placed[side].some(
          p => p.lane === lane && Math.abs(p.ms - mMs) < cardTimeSpan
        )
        if (!conflict) break
        lane++
      }
    }

    placed[side].push({ ms: mMs, lane })
    return { ...m, above, lane }
  })
}
