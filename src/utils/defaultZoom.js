import { ZOOM_LEVELS } from './timeline'

// The zoom the timeline opens at, chosen in Settings. A device setting like
// the theme and text size: kept in localStorage, never synced and not in
// backups, so a phone can open on years while a desktop opens on months.
// 'custom' is not offered: it is a span typed for one look, not a place to
// start from.

export const DEFAULT_ZOOM_KEY = 'lifeglance-default-zoom'
/** What the timeline opened at before the setting existed, and still does until one is chosen. */
export const FALLBACK_ZOOM = 'years'

const defaultStorage = () => (typeof localStorage === 'undefined' ? null : localStorage)

/** The chosen level, or 'years' for none, an unknown one, or storage that cannot be read. */
export function getDefaultZoom(storage = defaultStorage()) {
  try {
    const stored = storage?.getItem(DEFAULT_ZOOM_KEY)
    return ZOOM_LEVELS.includes(stored) ? stored : FALLBACK_ZOOM
  } catch {
    return FALLBACK_ZOOM
  }
}

/** Keeps the choice and returns what was kept; anything but a named level is 'years'. */
export function setDefaultZoom(zoom, storage = defaultStorage()) {
  const level = ZOOM_LEVELS.includes(zoom) ? zoom : FALLBACK_ZOOM
  try { storage?.setItem(DEFAULT_ZOOM_KEY, level) } catch { /* this session still follows it */ }
  return level
}
