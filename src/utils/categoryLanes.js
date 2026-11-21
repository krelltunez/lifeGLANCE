// Category lanes (issue #408): with the "group chapters by category" setting on,
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
  const known = new Set(categories.map(c => c.id))
  const laneIdOf = ch => (ch.category && known.has(ch.category) ? ch.category : GENERAL_LANE)

  const byLane = new Map()
  for (const ch of chapters) {
    const id = laneIdOf(ch)
    if (!byLane.has(id)) byLane.set(id, [])
    byLane.get(id).push(ch)
  }

  const startOf = ch => new Date(ch.start).getTime()
  const endOf   = ch => (ch.end ? new Date(ch.end).getTime() : todayMs)

  const order = [...categories, { id: GENERAL_LANE, label: null, color: null }]
  return order
    .filter(cat => byLane.has(cat.id))
    .map(cat => {
      const packed = packRows(byLane.get(cat.id), startOf, endOf)
      return {
        id: cat.id,
        label: cat.label,
        color: cat.color,
        chapters: packed,
        rows: Math.max(...packed.map(c => c._row)) + 1,
      }
    })
}
