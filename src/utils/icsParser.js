// ICS (iCalendar) parser — all-day events only.
// Timed events (anything with a T in DTSTART) are skipped and counted separately.

const CAT_KEYWORDS = [
  { cat: 'family',    words: ['family', 'kid', 'child', 'parent', 'wedding', 'reunion', 'baby', 'shower'] },
  { cat: 'travel',    words: ['travel', 'vacation', 'trip', 'holiday', 'flight', 'cruise', 'visit'] },
  { cat: 'career',    words: ['work', 'career', 'job', 'profession', 'conference', 'interview', 'promotion', 'retire', 'hired', 'fired', 'start date', 'last day'] },
  { cat: 'home',      words: ['home', 'house', 'moving', 'move', 'garden', 'renovation', 'closing', 'lease', 'apartment'] },
  { cat: 'health',    words: ['health', 'medical', 'doctor', 'fitness', 'gym', 'surgery', 'hospital', 'recovery'] },
  { cat: 'education', words: ['school', 'education', 'college', 'university', 'graduation', 'class', 'course', 'degree', 'semester', 'commencement'] },
  { cat: 'personal',  words: ['birthday', 'anniversar', 'personal'] },
]

function guessCategory(icsCategories, summary) {
  const text = [...icsCategories, summary].join(' ').toLowerCase()
  for (const { cat, words } of CAT_KEYWORDS) {
    if (words.some(w => text.includes(w))) return cat
  }
  return 'personal'
}

// Undo ICS line-folding: CRLF (or LF) followed by a space/tab is a continuation
function unfold(text) {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')
}

// Unescape ICS text values
function unescape(val) {
  return val
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g,  ',')
    .replace(/\\;/g,  ';')
    .replace(/\\\\/g, '\\')
}

// Returns a Date for YYYYMMDD all-day values, or null if timed/invalid
function parseAllDayDate(val) {
  if (val.includes('T')) return null
  const m = val.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3])
}

/**
 * Parse an ICS string and return:
 *   candidates  — array of candidate milestone objects (all-day events only)
 *   timedCount  — number of timed events that were skipped
 */
export function parseIcs(text) {
  const lines = unfold(text).split(/\r?\n/)

  const events = []
  let inEvent  = false
  let current  = null
  let timedCount = 0

  for (const line of lines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue

    const propFull = line.slice(0, colonIdx).toUpperCase()
    const propName = propFull.split(';')[0]
    const val      = unescape(line.slice(colonIdx + 1)).trim()

    if (propName === 'BEGIN' && val === 'VEVENT') {
      inEvent = true
      current = { categories: [] }
      continue
    }
    if (propName === 'END' && val === 'VEVENT') {
      inEvent = false
      if (current) {
        if (current._timed) {
          timedCount++
        } else if (current.date) {
          events.push(current)
        }
      }
      current = null
      continue
    }

    if (!inEvent || !current) continue

    switch (propName) {
      case 'DTSTART': {
        if (val.includes('T')) {
          current._timed = true
        } else {
          const d = parseAllDayDate(val)
          if (d) current.date = d
          else   current._timed = true
        }
        break
      }
      case 'SUMMARY':
        current.title = val
        break
      case 'DESCRIPTION':
        current.note = val
        break
      case 'URL':
        current.url = val
        break
      case 'CATEGORIES':
        current.categories = val.split(',').map(s => s.trim()).filter(Boolean)
        break
      case 'RRULE':
        if (val.toUpperCase().includes('FREQ=YEARLY')) current.isRecurring = true
        break
      default:
        break
    }
  }

  const candidates = events
    .map((e, i) => ({
      key:         i,
      title:       (e.title || '').trim() || '(untitled)',
      date:        e.date,
      note:        e.note        || '',
      url:         e.url         || '',
      category:    guessCategory(e.categories, e.title || ''),
      isRecurring: !!e.isRecurring,
      selected:    true,
    }))
    .sort((a, b) => a.date - b.date)

  return { candidates, timedCount }
}
