import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getTheme, toggleTheme } from '../../utils/theme'

// Crisp line icons (currentColor) so they sit cleanly inline with the
// monospace label instead of an emoji glyph that renders high and off-baseline.
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

// Toggles dark / light theme. Tracks its own state since the theme lives on the
// document (data-theme), not in React. Shows the icon for the theme you'd switch to.
export default function ThemeToggle() {
  const { t } = useTranslation('settings')
  const [theme, setTheme] = useState(getTheme)

  return (
    <button
      type="button"
      className="onboarding-link theme-toggle"
      onClick={() => setTheme(toggleTheme())}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      {t('themeLabel')}
    </button>
  )
}
