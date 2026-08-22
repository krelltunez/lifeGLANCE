import { applyRecurFilter } from './timeline'
import { precomputeEndpoints, getMilestoneVisibility } from './visibility'

// Builds the Core Spotlight index payload: one compact entry per searchable
// milestone, consumed by the iOS Spotlight plugin (src/native/spotlightBridge.js
// → ios/App/App/SpotlightPlugin.swift).
//
// This is deliberately NOT the widget snapshot. That projection is a bounded,
// widget-shaped summary (next/prev, pins, a ≤20-item strip); Spotlight needs
// every searchable milestone, so it gets its own full feed rather than growing
// the snapshot every widget also has to carry.
//
// Two rules are inherited from the snapshot builder, for the same reasons:
//   - Only milestones visible on the main timeline are indexed. System search is
//     the last place something the user hid should resurface.
//   - Recurring series collapse to one instance (nearest upcoming, else most
//     recent past), so a yearly birthday is one search result, not thirty
//     identical rows.

const MAX_NOTE = 160

// Formats the date at the milestone's own precision, in the device locale —
// "2019", "June 2019", or "June 12, 2019". Spotlight rows are static text, so
// unlike widgets there is no relative-label staleness concern.
function formatForPrecision(iso, precision, locale) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  if (precision === 'year') return String(d.getUTCFullYear())
  const opts = precision === 'day'
    ? { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }
    : { year: 'numeric', month: 'long', timeZone: 'UTC' }
  try {
    return d.toLocaleDateString(locale, opts)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/**
 * @returns {{ id: string, title: string, desc: string }[]} entries for
 *   CSSearchableItem — `desc` becomes contentDescription (the line under the
 *   title in search results): the date, plus a note excerpt when there is one.
 */
export function buildSpotlightIndex(milestones = [], chapters = [], locale = undefined) {
  const precomputed = precomputeEndpoints(chapters)
  const visible = milestones.filter(
    m => getMilestoneVisibility(m, chapters, precomputed, 'main').visible
  )
  const collapsed = applyRecurFilter(visible, 'next')

  return collapsed
    .filter(m => m.id && m.title)
    .map(m => {
      const date = formatForPrecision(m.date, m.date_precision ?? 'day', locale)
      let note = (m.note || '').replace(/\s+/g, ' ').trim()
      if (note.length > MAX_NOTE) note = note.slice(0, MAX_NOTE).trim() + '…'
      return {
        id: m.id,
        title: m.title,
        desc: note ? `${date} · ${note}` : date,
      }
    })
}
