import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DARK_BG, DEFAULT_WINDOW_STATE, LIGHT_BG, WINDOW_STATE_FILE,
  loadWindowState, onScreen, parseWindowState, savedThemeIsDark, saveWindowState, saveWindowTheme, windowBackgroundColor,
} from './windowState.js'

describe('window state', () => {
  let dir
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeglance-winstate-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('uses the defaults on a first launch or a corrupt file', () => {
    expect(loadWindowState(dir)).toEqual(DEFAULT_WINDOW_STATE)
    fs.writeFileSync(path.join(dir, WINDOW_STATE_FILE), '{not json')
    expect(loadWindowState(dir)).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('round-trips the saved bounds', () => {
    saveWindowState(dir, { x: 10, y: 20, width: 900, height: 700, maximized: true })
    expect(loadWindowState(dir)).toEqual({ x: 10, y: 20, width: 900, height: 700, maximized: true })
  })

  it('rejects nonsense sizes and drops a half-saved position', () => {
    expect(parseWindowState({ width: -1, height: 700 })).toEqual(DEFAULT_WINDOW_STATE)
    expect(parseWindowState({ width: 900, height: 700, x: 5 })).toEqual({ width: 900, height: 700, maximized: false })
  })

  describe('onScreen', () => {
    const primary = { x: 0, y: 0, width: 1920, height: 1080 }
    const state = { width: 1200, height: 800, maximized: false }

    it('keeps a position on a connected display', () => {
      expect(onScreen({ ...state, x: 100, y: 100 }, [primary])).toEqual({ ...state, x: 100, y: 100 })
    })

    it('drops a position left on a display that is gone', () => {
      expect(onScreen({ ...state, x: 2500, y: 100 }, [primary])).toEqual(state)
    })

    it('drops a position whose title bar is above every display', () => {
      expect(onScreen({ ...state, x: 100, y: -500 }, [primary])).toEqual(state)
    })

    it('keeps a position on a second display left of the primary', () => {
      const left = { x: -1440, y: 0, width: 1440, height: 900 }
      expect(onScreen({ ...state, x: -1300, y: 50 }, [primary, left])).toEqual({ ...state, x: -1300, y: 50 })
    })
  })

  it('paints dark until the renderer reports light', () => {
    expect(windowBackgroundColor(dir)).toBe(DARK_BG)
    expect(savedThemeIsDark(dir)).toBe(true)
    saveWindowTheme(dir, false)
    expect(windowBackgroundColor(dir)).toBe(LIGHT_BG)
    expect(savedThemeIsDark(dir)).toBe(false)
    saveWindowTheme(dir, true)
    expect(windowBackgroundColor(dir)).toBe(DARK_BG)
    fs.writeFileSync(path.join(dir, 'window-theme.json'), '{"dark":"no"}')
    expect(savedThemeIsDark(dir)).toBe(true)
  })

  it('matches the app’s own backgrounds (src/index.css, src/utils/theme.js)', () => {
    // A mismatch is a flash of the wrong color on every launch.
    const css = fs.readFileSync(path.resolve(import.meta.dirname, '../src/index.css'), 'utf-8')
    const dark = /:root\s*\{[^}]*--bg:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1]
    const light = /\[data-theme="light"\]\s*\{[^}]*--bg:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1]
    expect([dark, light]).toEqual([DARK_BG, LIGHT_BG])
  })
})
