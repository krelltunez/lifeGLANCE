export const ZOOM_LEVELS = ['decades', 'years', 'months', 'weeks']

// Half-range in milliseconds for each zoom level (total range = 2×)
const HALF_RANGE_MS = {
  decades: 50  * 365.25 * 24 * 3600 * 1000,
  years:   10  * 365.25 * 24 * 3600 * 1000,
  months:  18  *  30.44 * 24 * 3600 * 1000,
  weeks:   13  *   7    * 24 * 3600 * 1000,
}

export function getTimeRange(zoom, centerMs) {
  const half = HALF_RANGE_MS[zoom]
  return {
    startMs: centerMs - half,
    endMs:   centerMs + half,
  }
}

export function dateToX(dateMs, startMs, endMs, width) {
  const span = endMs - startMs
  if (span === 0) return width / 2
  return ((dateMs - startMs) / span) * width
}

export function xToMs(x, startMs, endMs, width) {
  return startMs + (x / width) * (endMs - startMs)
}

export function getMsPerPx(zoom, width) {
  return (HALF_RANGE_MS[zoom] * 2) / width
}

// Generate tick marks for the current view
export function getTickMarks(zoom, startMs, endMs, width) {
  const ticks = []
  const startDate = new Date(startMs)
  const endDate   = new Date(endMs)

  if (zoom === 'decades') {
    const startYear = Math.floor(startDate.getFullYear() / 10) * 10
    for (let y = startYear; y <= endDate.getFullYear(); y++) {
      const x = dateToX(new Date(y, 0, 1).getTime(), startMs, endMs, width)
      if (x < -2 || x > width + 2) continue
      const major = y % 10 === 0
      ticks.push({ x, label: major ? String(y) : (y % 5 === 0 ? String(y) : ''), major })
    }
  } else if (zoom === 'years') {
    for (let y = startDate.getFullYear(); y <= endDate.getFullYear(); y++) {
      const x = dateToX(new Date(y, 0, 1).getTime(), startMs, endMs, width)
      if (x < -2 || x > width + 2) continue
      ticks.push({ x, label: String(y), major: true })
    }
  } else if (zoom === 'months') {
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
  } else if (zoom === 'weeks') {
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
// maxLane caps how far cards can stray from the axis (caller computes from geometry).
// Returns array of milestones with { above: bool, lane: number (0-based) }
export function assignLanes(milestones, maxLane = 0) {
  const sorted = [...milestones].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  )
  return sorted.map((m, i) => ({
    ...m,
    above: i % 2 === 0,
    lane: Math.min(Math.floor(i / 2), maxLane),
  }))
}
