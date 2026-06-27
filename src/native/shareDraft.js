// Maps a shared item (from the Android share sheet — ACTION_SEND text/plain) into
// a draft milestone the Add sheet can be pre-filled with. Pure and platform-free
// so it's unit-testable without a DOM; the native side only forwards { text,
// subject } and this decides how they become a milestone's title / url / note.

const URL_RE = /https?:\/\/\S+/i
const MAX_TITLE = 120

/**
 * @param {{ text?: string, subject?: string } | null | undefined} share
 * @returns {{ title: string, url: string, note: string } | null}
 *   A draft to seed the Add-milestone sheet, or null if there's nothing usable.
 */
export function shareToMilestoneDraft(share) {
  if (!share || typeof share !== 'object') return null
  const text = typeof share.text === 'string' ? share.text.trim() : ''
  const subject = typeof share.subject === 'string' ? share.subject.trim() : ''
  if (!text && !subject) return null

  // First URL found in the shared text (browsers/apps usually share the link there).
  const match = text.match(URL_RE)
  const url = match ? match[0] : ''

  // Title: prefer an explicit subject (e.g. a page title); otherwise the shared
  // text with the URL removed; otherwise the URL's hostname. One line, capped.
  let title = subject || (url ? text.replace(url, ' ') : text)
  title = title.replace(/\s+/g, ' ').trim()
  if (!title && url) {
    try {
      title = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      /* leave title empty */
    }
  }
  if (title.length > MAX_TITLE) title = title.slice(0, MAX_TITLE).trim()

  // Keep the full shared text as a note when it carries more than the title/url.
  const note = text && text !== title && text !== url ? text : ''

  if (!title && !url && !note) return null
  return { title, url, note }
}
