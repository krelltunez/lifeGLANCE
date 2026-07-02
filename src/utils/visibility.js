/**
 * Cascade visibility model with endpoint floor.
 *
 * Priority order (highest wins):
 *   1. Endpoint floor  — milestone date matches a member chapter's start or end → always shown
 *   2. Milestone override — mainTimelineVisibility 'shown' or 'hidden' → use directly
 *   3. Chapter cascade — when 'inherit': any member chapter with defaultMemberVisibility
 *      'shown' → shown; all member chapters 'hidden' → hidden; no chapters → shown
 *
 * The drill-in context ('chapterDrilldown') bypasses all rules and always returns 'shown'
 * so Phase 5 can use this function directly without modifications.
 */

/**
 * Chapters honor the same category filter as milestones. `filter` is the Set of
 * selected category ids (empty = no filter, show everything). When a filter is
 * active, a chapter shows only if its `category` tag is one of the selected ids;
 * an untagged chapter (category null/undefined) is hidden under an active filter
 * and shown when the filter is cleared — matching milestone filter behavior.
 *
 * Pure and side-effect-free so it's directly unit-testable.
 *
 * @param {Array} chapters
 * @param {Set<string>} filter  selected category ids
 * @returns {Array} the chapters that pass the filter
 */
export function filterChaptersByCategory(chapters, filter) {
  if (!filter || filter.size === 0) return chapters
  return chapters.filter(c => c.category != null && filter.has(c.category))
}

/**
 * Precomputes a Set of milestone IDs that are endpoints of any chapter.
 * Also returns a Map from milestoneId → array of chapter names it anchors.
 *
 * Precomputing avoids O(chapters) work per milestone on every render.
 * Call once when chapters change, then pass the result to getMilestoneVisibility.
 *
 * @param {Array} chapters
 * @returns {{ endpointChapterNames: Map<string, string[]> }}
 */
export function precomputeEndpoints(chapters) {
  const endpointIds          = new Set()
  const endpointChapterNames = new Map()

  for (const chapter of chapters) {
    const startDay = chapter.start.slice(0, 10)
    const endDay   = chapter.end ? chapter.end.slice(0, 10) : null  // null for ongoing chapters

    for (const milestoneId of chapter.milestoneIds) {
      // Endpoint status requires both date match AND membership — checked by
      // the caller when building milestoneIds, so here we trust the list.
      // We still need to compare dates when resolving, so store chapter refs.
      // But the precomputation is driven by chapter.start/end vs milestone.date,
      // which we resolve below using the milestone's own date field.
      //
      // We can't fully resolve here without the milestones array, so we store
      // the chapter's start/end dates per member and let getMilestoneVisibility
      // do the final date comparison cheaply.
      if (!endpointChapterNames.has(milestoneId)) {
        endpointChapterNames.set(milestoneId, [])
      }
      // Store { chapterTitle, startDay, endDay } so getMilestoneVisibility can
      // check date match without re-scanning chapters. endDay is null for ongoing.
      endpointChapterNames.get(milestoneId).push({ title: chapter.title, startDay, endDay })
    }
  }

  return { endpointChapterNames }
}

/**
 * Returns visibility info for a single milestone.
 *
 * @param {Object} milestone  — must have .date, .mainTimelineVisibility, .id
 * @param {Array}  chapters   — all chapters (used for cascade; not for endpoint, see below)
 * @param {Object} precomputed — result of precomputeEndpoints(chapters)
 * @param {'main'|'chapterDrilldown'} context
 * @returns {{
 *   visible: boolean,
 *   reason: 'endpoint'|'milestone-shown'|'milestone-hidden'|'cascade-shown'|'cascade-hidden'|'no-chapters',
 *   endpointChapters: string[],   // chapter titles this milestone anchors (may be empty)
 *   inheritedResolution: 'shown'|'hidden'|null,  // resolved value when setting is 'inherit'
 *   inheritSource: string|null,   // human-readable explanation of the cascade result
 * }}
 */
export function getMilestoneVisibility(milestone, chapters, precomputed, context = 'main') {
  if (context === 'chapterDrilldown') {
    return { visible: true, reason: 'drilldown', endpointChapters: [], inheritedResolution: null, inheritSource: null }
  }

  const milestoneDay = milestone.date ? milestone.date.slice(0, 10) : null
  const candidateChapters = precomputed.endpointChapterNames.get(milestone.id) ?? []

  // Endpoint chapters: member chapters whose start or end date matches this milestone's date.
  // Ongoing chapters (endDay === null) can only match via their start day.
  const endpointChapters = milestoneDay
    ? candidateChapters
        .filter(c => c.startDay === milestoneDay || (c.endDay && c.endDay === milestoneDay))
        .map(c => c.title)
    : []

  // 1. Endpoint floor
  if (endpointChapters.length > 0) {
    return { visible: true, reason: 'endpoint', endpointChapters, inheritedResolution: null, inheritSource: null }
  }

  // 2. Explicit milestone override
  const setting = milestone.mainTimelineVisibility ?? 'inherit'

  if (setting === 'shown') {
    return { visible: true, reason: 'milestone-shown', endpointChapters: [], inheritedResolution: null, inheritSource: null }
  }
  if (setting === 'hidden') {
    return { visible: false, reason: 'milestone-hidden', endpointChapters: [], inheritedResolution: null, inheritSource: null }
  }

  // 3. Cascade from chapters (setting === 'inherit')
  const memberChapters = chapters.filter(c => c.milestoneIds.includes(milestone.id))

  if (memberChapters.length === 0) {
    return { visible: true, reason: 'no-chapters', endpointChapters: [], inheritedResolution: 'shown', inheritSource: 'not a member of any chapter' }
  }

  const anyShown = memberChapters.some(c => c.defaultMemberVisibility === 'shown')

  if (anyShown) {
    const shownChapter = memberChapters.find(c => c.defaultMemberVisibility === 'shown')
    return {
      visible: true,
      reason: 'cascade-shown',
      endpointChapters: [],
      inheritedResolution: 'shown',
      // Bare chapter title; the visInheritShown label supplies the localized
      // "member of '…'" framing so it translates instead of leaking English.
      inheritSource: shownChapter.title,
    }
  }

  // All member chapters are hidden-by-default. inheritSource is the bare list of
  // quoted titles; the visInheritHidden label supplies the localized framing.
  const hiddenNames = memberChapters.map(c => `'${c.title}'`).join(', ')
  return {
    visible: false,
    reason: 'cascade-hidden',
    endpointChapters: [],
    inheritedResolution: 'hidden',
    inheritSource: hiddenNames,
  }
}
