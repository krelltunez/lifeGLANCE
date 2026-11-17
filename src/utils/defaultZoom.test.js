import { describe, it, expect } from 'vitest'
import { DEFAULT_ZOOM_KEY, FALLBACK_ZOOM, getDefaultZoom, setDefaultZoom } from './defaultZoom'
import { ZOOM_LEVELS } from './timeline'

const memStorage = (initial = {}) => {
  const m = new Map(Object.entries(initial))
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)) } }
}

describe('the default zoom', () => {
  it('is years until one is chosen, as it always was', () => {
    expect(FALLBACK_ZOOM).toBe('years')
    expect(getDefaultZoom(memStorage())).toBe('years')
  })

  it('is whichever named level was chosen', () => {
    for (const level of ZOOM_LEVELS) {
      const storage = memStorage()
      expect(setDefaultZoom(level, storage)).toBe(level)
      expect(getDefaultZoom(storage)).toBe(level)
    }
  })

  it('never opens on custom or on something it does not know', () => {
    for (const stored of ['custom', 'fortnights', '', 'YEARS', 'null']) {
      expect(getDefaultZoom(memStorage({ [DEFAULT_ZOOM_KEY]: stored }))).toBe('years')
    }
    const storage = memStorage()
    expect(setDefaultZoom('custom', storage)).toBe('years')
    expect(storage.getItem(DEFAULT_ZOOM_KEY)).toBe('years')
  })

  it('falls back to years when storage cannot be read or written', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(getDefaultZoom(broken)).toBe('years')
    expect(setDefaultZoom('months', broken)).toBe('months')   // this session still follows the choice
    expect(getDefaultZoom(null)).toBe('years')
  })
})
