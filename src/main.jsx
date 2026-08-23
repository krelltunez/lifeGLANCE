import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ready as i18nReady } from './i18n'
import { applyTheme, getTheme } from './utils/theme'

// Reflect the saved theme (the inline script in index.html also does this early
// to avoid a flash; this keeps things correct if that script is ever stripped).
applyTheme(getTheme())

function mount() {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

// Translations load as per-language chunks, so wait for the active language
// before first paint — otherwise non-English users see the UI flash in English
// and swap a moment later. A failed load still mounts (in English) rather than
// leaving a blank screen.
i18nReady.then(mount, (error) => {
  console.error('Translations failed to load; continuing in English:', error)
  mount()
})
