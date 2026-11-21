// Category lanes (issue #408): with the "one lane per category" setting on,
// the chapter band is split into one fixed lane per category, so every chapter
// of a category sits at the same height across the whole timeline.

// Lane id for chapters with no category, or with a category that no longer exists.
export const GENERAL_LANE = '__general'

// Greedy interval packing, the same rule assignChapterRows uses for the whole
// band: each item takes the lowest row whose last item has ended by its start.
// Returns a new array, sorted by start, with `_row` set on each item.
export function packRows(items, startOf, endOf) {
  const sorted = [...items].sort((a, b) => startOf(a) - startOf(b))
  const rowEnds = []
  return sorted.map(item => {
    const s = startOf(item)
    let row = rowEnds.findIndex(end => end <= s)
    if (row === -1) { row = rowEnds.length; rowEnds.push(endOf(item)) }
    else rowEnds[row] = endOf(item)
    return { ...item, _row: row }
  })
}

// Groups chapters into lanes, in the order of the user's category list, with
// the general lane last. Only lanes that hold at least one chapter are
// returned, so the band never shows empty rows.
//
// Each lane: { id, label, color, chapters (with `_row` inside the lane), rows }.
// `label` is null for the general lane; the caller supplies a translated name.
export function buildChapterLanes(chapters, categories = [], todayMs = Date.now()) {
  return buildSwimlanes(chapters, [], categories, todayMs)
}

// Swimlanes (issue #408, phase 2): as buildChapterLanes, but milestones join
// their category's lane too, and a lane with only milestones is kept. Each
// lane also carries `milestones` (unsorted; the renderer packs them by pixel
// position, which depends on the zoom). `rows` is 0 for a lane with no chapters.
export function buildSwimlanes(chapters, milestones = [], categories = [], todayMs = Date.now()) {
  const known = new Set(categories.map(c => c.id))
  const laneIdOf = item => (item.category && known.has(item.category) ? item.category : GENERAL_LANE)

  const byLane = new Map()
  const laneFor = id => {
    if (!byLane.has(id)) byLane.set(id, { chapters: [], milestones: [] })
    return byLane.get(id)
  }
  for (const ch of chapters)  laneFor(laneIdOf(ch)).chapters.push(ch)
  for (const m of milestones) laneFor(laneIdOf(m)).milestones.push(m)

  const startOf = ch => new Date(ch.start).getTime()
  const endOf   = ch => (ch.end ? new Date(ch.end).getTime() : todayMs)

  const order = [...categories, { id: GENERAL_LANE, label: null, color: null }]
  return order
    .filter(cat => byLane.has(cat.id))
    .map(cat => {
      const lane = byLane.get(cat.id)
      const packed = packRows(lane.chapters, startOf, endOf)
      return {
        id: cat.id,
        label: cat.label,
        color: cat.color,
        chapters: packed,
        rows: packed.length ? Math.max(...packed.map(c => c._row)) + 1 : 0,
        milestones: lane.milestones,
      }
    })
}

// Packs milestone markers (a dot plus a label to its right) into at most
// `maxRows` rows of a lane, so labels do not run into each other. Each marker
// takes the first row free at its x; when none is, the row that frees up
// soonest. `_room` is then the space its label has before the next marker in
// the same row (Infinity for the last), so the renderer can shorten or drop it.
// Returns a new array, sorted by x, with `_row` and `_room` set.
export function packMarkers(items, xOf, widthOf, maxRows) {
  const sorted = [...items].sort((a, b) => xOf(a) - xOf(b))
  const rowEnds = []
  const placed = sorted.map(item => {
    const x = xOf(item)
    let row = rowEnds.findIndex(end => end <= x)
    if (row === -1 && rowEnds.length < maxRows) row = rowEnds.length
    if (row === -1) row = rowEnds.indexOf(Math.min(...rowEnds))
    rowEnds[row] = x + widthOf(item)
    return { ...item, _row: row, _x: x, _room: Infinity }
  })
  const lastInRow = []
  for (const m of placed) {
    const prev = lastInRow[m._row]
    if (prev) prev._room = m._x - prev._x
    lastInRow[m._row] = m
  }
  return placed.map(({ _x, ...m }) => m)
}
