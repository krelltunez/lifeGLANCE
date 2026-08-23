import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ready as i18nReady } from './i18n'
import { applyTheme, getTheme } from './utils/theme'
import { hydrateSecureConfig, installSecureConfigShim } from './sync/secureConfigShim'

// On native shells, route credential-bearing localStorage keys through the
// SecureStore before ANYTHING can read or write them. Install must precede the
// first secret-key access; no imported module reads those keys at module scope
// (all reads happen inside components/effects, post-mount), so installing here
// — before mount is gated below — is early enough. On web/PWA both calls are
// no-ops.
installSecureConfigShim()

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
//
// Secure-config hydration ALSO gates the first paint: the sync engines and the
// intents transport read their config synchronously during mount, and a miss
// would present as "sync not configured". hydrateSecureConfig never rejects
// (per-key failures degrade to the pre-migration status quo internally).
Promise.all([i18nReady, hydrateSecureConfig()]).then(mount, (error) => {
  console.error('Translations failed to load; continuing in English:', error)
  mount()
})
