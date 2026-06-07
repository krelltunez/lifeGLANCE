// Activity log for intents events — stored in localStorage, capped at MAX_ENTRIES.

const KEY = 'lifeglance-intents-activity'
const MAX_ENTRIES = 200

export function loadActivityLog() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function appendActivityEntry(entry) {
  const log = loadActivityLog()
  log.unshift({ ...entry, timestamp: entry.timestamp ?? new Date().toISOString() })
  if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES
  localStorage.setItem(KEY, JSON.stringify(log))
}

export function clearActivityLog() {
  localStorage.removeItem(KEY)
}
