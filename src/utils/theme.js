// Colour theme: 'dark' (default) or 'light'. Persisted in localStorage and
// applied as a data-theme attribute on <html>, which swaps the CSS token palette.

const KEY = 'lifeglance-theme'
export const THEMES = ['dark', 'light']

// Browser-chrome colour shown in the address bar / status bar per theme.
const THEME_COLOR = { dark: '#0F1117', light: '#F4EFE4' }

export function getTheme() {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

// Reflect the theme onto the document. Safe to call repeatedly.
export function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', t)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[t])
  return t
}

export function setTheme(theme) {
  const t = applyTheme(theme)
  try { localStorage.setItem(KEY, t) } catch { /* ignore */ }
  return t
}

// Flip between dark and light, persist, and return the new theme.
export function toggleTheme() {
  return setTheme(getTheme() === 'light' ? 'dark' : 'light')
}
