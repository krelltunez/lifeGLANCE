// Window bounds and the pre-paint background, persisted in userData
// (docs/desktop-app.md, "The window"). lastGLANCE's electron/windowState.ts.
//
// Best-effort throughout: a missing or corrupt file means the defaults, and a
// failed write is ignored. Neither may stop the window from opening.

import fs from 'node:fs'
import path from 'node:path'

export const WINDOW_STATE_FILE = 'window-state.json'
export const WINDOW_THEME_FILE = 'window-theme.json'

// A timeline wants width: the default is a landscape window.
export const DEFAULT_WINDOW_STATE = Object.freeze({ width: 1280, height: 800, maximized: false })

// The app's own backgrounds (--bg in src/index.css, the same values index.html
// gives the theme-color meta). The window paints this before the renderer's
// first frame, so it must match or every launch flashes the wrong color.
export const DARK_BG = '#0F1117'
export const LIGHT_BG = '#F4EFE4'

const finite = (n) => typeof n === 'number' && Number.isFinite(n)

/** @returns {{ x?: number, y?: number, width: number, height: number, maximized: boolean }} */
export function parseWindowState(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WINDOW_STATE }
  if (!finite(raw.width) || !finite(raw.height) || raw.width <= 0 || raw.height <= 0) return { ...DEFAULT_WINDOW_STATE }
  return {
    width: Math.round(raw.width),
    height: Math.round(raw.height),
    maximized: raw.maximized === true,
    ...(finite(raw.x) && finite(raw.y) ? { x: Math.round(raw.x), y: Math.round(raw.y) } : {}),
  }
}

/**
 * The saved state with its position dropped when no display can show the
 * window's title area any more (a monitor unplugged since the last run). The
 * OS then centers it. Requires a 100x40 overlap with some display's work area,
 * enough to grab the title bar.
 *
 * @param {{ x?: number, y?: number, width: number, height: number, maximized: boolean }} state
 * @param {{ x: number, y: number, width: number, height: number }[]} workAreas
 */
export function onScreen(state, workAreas) {
  if (state.x == null || state.y == null) return state
  const { x, y, width } = state
  const visible = workAreas.some((a) => {
    const w = Math.min(x + width, a.x + a.width) - Math.max(x, a.x)
    const h = Math.min(y + 40, a.y + a.height) - Math.max(y, a.y)
    return w >= 100 && h >= 40
  })
  if (visible) return state
  return { width: state.width, height: state.height, maximized: state.maximized }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

function writeJson(file, value) {
  try {
    fs.writeFileSync(file, JSON.stringify(value))
  } catch { /* best-effort */ }
}

export function loadWindowState(userData) {
  return parseWindowState(readJson(path.join(userData, WINDOW_STATE_FILE)))
}

export function saveWindowState(userData, state) {
  writeJson(path.join(userData, WINDOW_STATE_FILE), state)
}

/**
 * The renderer reports its theme, which main cannot read from localStorage, so
 * the NEXT launch's window opens in the right color.
 */
export function saveWindowTheme(userData, dark) {
  writeJson(path.join(userData, WINDOW_THEME_FILE), { dark })
}

/** The app is dark until the user picks light (src/utils/theme.js), whatever the OS says. */
export function savedThemeIsDark(userData) {
  return readJson(path.join(userData, WINDOW_THEME_FILE))?.dark !== false
}

export function windowBackgroundColor(userData) {
  return savedThemeIsDark(userData) ? DARK_BG : LIGHT_BG
}
