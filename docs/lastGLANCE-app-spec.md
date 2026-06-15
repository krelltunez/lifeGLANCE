*Working document. Captures sequencing, architectural decisions, and open questions.*

---

Third standalone app in the GLANCE family. Tracks when you last did recurring upkeep activities, with optional cadence and optional auto-scheduling to dayGLANCE.

## Core thesis

Chores are fundamentally different from tasks, routines, events, goals, and projects:

- **Events** are scheduled in advance, inflexible
- **Tasks** are not skippable, have deadlines, can be one-and-done or recurring
- **Routines** are daily/weekly, flexible, skippable, don't need "credit" (meds, meals, TV with spouse)
- **Goals/Projects** are outcome-oriented with task rollup
- **Chores** are irregular upkeep that benefit from tracking when last done, but shouldn't generate guilt when put off

The emotional register is the key design constraint. Saying "mop the floor every 2 weeks" leads to disappointment and frustration. The app should surface **information** (last done when) without **judgment** (you're overdue).

The name itself reflects this: lastGLANCE answers "when did I last do this?" rather than "when do I need to do this next?" Most chore apps focus on what's coming up. lastGLANCE focuses on what's already been done.

## Artificial Intelligence

**BYO API key.** Consistent with the GLANCE family's "your data, your services, your call" stance. Self-hosters bring their own Anthropic, OpenAI, or compatible-API key; the app doesn't phone home for inference. No separate billing relationship for the project to manage, no free-tier-vs-paid-tier split in the UX. Everyone gets the same lastGLANCE; if you want AI features, you plug in a key.

**Surface: detail view, not dashboard.** AI features live in the per-chore detail view. The dashboard is the at-a-glance read; cluttering it with AI suggestions would compete with the core scan-and-act loop. The detail view is where users are already in "thinking mode" — examining history, considering whether the cadence is right — so AI prompts there feel like a research assistant rather than a chatbot interrupting the morning.

**Cadence determination:** AI-inferred cadence after enough completion history exists. Not v1, but the data model supports it — completion history is already being recorded, so cadence inference is a later addition without schema changes.

**v1 features:** none. AI is deferred past v1.0.0. The detail view is structured to support AI additions later (Total / Avg interval / Target / completion history / per-completion notes is the data substrate AI would consume).

**Implementation considerations** (for when AI ships):

- **Provider abstraction.** Build against a thin internal interface from the start so users can BYO their preferred provider — Anthropic, OpenAI, OpenAI-compatible endpoints, local Ollama — with one config change. The audience here will request Ollama.
- **Key storage:** local browser storage for web, native secure storage (Keystore on Android, Keychain on iOS) for native apps, env var or config file for Docker. Self-hosters care about this; document it clearly.
- **Privacy granularity:** a per-call or global "include notes in AI requests" toggle. Some users will have sensitive completion notes and may not want them leaving the device even with their own key.
- **Model defaults:** smart default (e.g. Haiku for cost) with an advanced override for users who want to pick.

## Architectural notes

- Local-first, privacy-first, consistent with rest of GLANCE family
- Reuses WebView hybrid Android pattern from dayGLANCE
- SQLite schema on Android, Dexie/IndexedDB on web
- Docker + Vercel deployment pattern for the web version, consistent with dayGLANCE and lifeGLANCE
- GitHub distribution via Obtainium for Android, potential Play Store presence
- Web, Android, iOS, and Electron all planned

## Brief summary / elevator pitch

Track when you last did stuff. If you want, set a cadence and it'll schedule itself in dayGLANCE when it's time. No guilt, no nagging, just information.

---
### Locked architectural decisions

- **Storage: Dexie (IndexedDB) for web, native SQLite for Android.** SQLite WASM requires `Atomics.wait()` which is blocked on the browser main thread; OPFS persistence is only possible from a dedicated worker. Dexie provides equivalent local-first persistence via IndexedDB with no worker or special HTTP headers required. The TypeScript data model is identical across both targets.
- **Standalone web-first, then Android, iOS, and Electron as separate releases.** Web PWA is the lead surface and is the v1.0.0 release; platform wrappers follow as their own version trains.
- **React 19 + Vite + Tailwind CSS + TypeScript.** Consistent with dayGLANCE stack.
- **Full PWA support from day one.** Service worker, offline precache, installable.
- **Shared `@glance-apps/intents` package for protocol implementation.** lastGLANCE consumes the published package rather than re-implementing protocol logic. Schema decisions and package build history are in `dayglance-intents-package.md`.
- **Optional encryption for WebDAV intent transport.** Gated on cloud sync encryption being enabled. Uses an intents-owned HKDF root key derived once at intents-encryption setup from the cloud sync passphrase plus a shared root salt stored on the WebDAV endpoint. Per-envelope encryption key is derived via HKDF from the cached root key plus a fresh per-envelope salt; passphrase is needed only at setup. Set-and-forget UX across app sessions. AES-GCM cipher. Independent toggle in integration settings. Android intent transport stays plaintext (intra-device).
- **AI is BYO key, deferred past v1.0.0.** See "AI" section above.
- **Visual identity is locked** (terminal-phosphor green wordmark, dark palette, masonry layout, contribution-graph header strip, color-gradient ribbon encoding).

### Shipped

- Project scaffold: Vite + React 19 + TypeScript, Tailwind, vite-plugin-pwa
- Dexie data layer: schema, all CRUD queries for Category, Chore, CompletionEvent
- Dashboard with freeform masonry layout: category cards arranged by user, each containing chore ribbon rows with color-gradient cadence encoding
- Contribution-graph header strip showing aggregate completion activity
- Visual identity: terminal-phosphor green wordmark, dark palette, "when did you last...?" tagline
- Cadence color logic: green → amber → orange → red gradient based on elapsed/target ratio
- Log completion flow: tap "Done" on a chore row to log; modal allows optional note and backdate
- Elapsed time display on cards: "just now" / "5m ago" / "2h ago" / "3d ago" / "13d ago" / "never"
- Management UI: edit mode toggle in header; add/edit/delete categories and chores; cadence field per chore; icon picker per chore and category; confirmation dialogs for destructive actions; drag handles for reordering categories (masonry) and chores within a category
- Per-chore edit modal: name, icon, category, optional cadence (days), "Notify when overdue" toggle (only appears when cadence is set — progressive disclosure)
- Per-chore detail view (modal overlay over darkened dashboard): stats row (Total, Avg interval, Target), past-year contribution graph, history list with absolute timestamps, per-completion notes, "Done earlier?" backdate field
- Full PWA asset set: app icons at all standard sizes, maskable variants, apple-touch-icon, favicon, manifest configured
- Docker + docker-compose.yml for self-hosters, consistent with dayGLANCE and lifeGLANCE distribution
- Responsive layout across small phones, tablets, desktop widths
- Search and subcategories
- **dayGLANCE intent integration:** card-level `+ dG` button when cadence threshold crossed, "Send to dayGLANCE" button in overdue notification popup, per-chore `auto_schedule_to_dayglance` toggle in edit form. Outbound `create` action on user trigger or auto-schedule. Inbound subscription to `notify` events over WebDAV that logs a CompletionEvent with `source="dayglance"` for `event=completed`. Detects dayGLANCE absence and WebDAV absence independently at runtime; hides integration UI accordingly.
- **Optional intents encryption** via Phase 2.7 of the intents package: HKDF-per-envelope key derivation against an intents-owned cached root key. Set-and-forget UX (passphrase needed only at intents-encryption setup, never on subsequent app sessions). Cross-app key agreement via shared root salt stored on the WebDAV endpoint.
- **Cloud sync via `@glance-apps/sync`:** local-first with optional WebDAV-backed sync. Encryption keyed on a passphrase; derived non-extractable `CryptoKey` cached in IndexedDB.
- **Remote backup to WebDAV.**
- **Multiuser and multidevice support.**

### Roadmap

1. **GLANCEvault support:** In progress/testing.
2. **Android wrapper:** WebView shell, native SQLite swap-in replacing Dexie, intent protocol wiring for dayGLANCE integration (Android intent transport in addition to WebDAV), Obtainium distribution, eventual Google Play presence.
3. **iOS app:** PWA-shell or native wrapper. WebDAV transport is the integration path on iOS (no Android intent equivalent). Background polling caveats apply.
4. **Electron app:** desktop build, consistent with the dayGLANCE Desktop pattern. WebDAV transport for cross-app integration.