# Native Widgets — Plan & Status

Living document for lifeGLANCE's native home-screen widgets (Android first, iOS to
follow). Captures the architecture, what's built, and the roadmap so work can resume
cleanly across sessions.

> Status legend: ✅ done · 🚧 in progress · ⏳ planned · 💡 idea

---

## The core constraint

lifeGLANCE is a **Capacitor app** — a React PWA in a WebView with a thin native
shell. **All data lives in IndexedDB inside the WebView**, which a widget's process
**cannot read**. So every widget depends on a **data bridge**: the web app pushes a
compact, render-ready snapshot into native `SharedPreferences`, and the widget reads
from there. This bridge is the foundation; the widgets themselves are comparatively
small once it exists.

---

## Architecture

```
React app (IndexedDB)                         Native (Android)
─────────────────────                         ────────────────
buildWidgetSnapshot()  ──push (debounced)──▶  WidgetBridgePlugin
  src/utils/widgetSnapshot.js                   → SharedPreferences("lifeglance_widget")
  src/native/widgetBridge.js                    → broadcast APPWIDGET_UPDATE
  hook in src/App.jsx                                    │
                                                         ▼
widget tap ◀──consumeLaunchTarget()──         NextMilestoneWidget (Glance)
  TimelineView focuses milestone                reads snapshot, renders, taps deep-link
                                              WidgetRefreshWorker (midnight tick)
```

### Snapshot schema (`buildWidgetSnapshot`)

Pure, unit-tested function. Reuses existing recurrence-collapse
(`applyRecurFilter('next')`) and **main-timeline visibility** logic, so hidden or
duplicated recurring milestones never surface. **Dates are stored as raw ISO** — the
widget computes relative labels ("in 12 days") itself at render time, because the
snapshot can be stale and those labels roll over at midnight.

```jsonc
{
  "version": 1,
  "generatedAt": "ISO",
  "birthday": "ISO | null",
  "next": { "id", "title", "date", "datePrecision", "category", "color" } | null,
  "prev": { ...same... } | null,                 // most recently passed
  "currentChapter": {
    "id", "title", "start", "end", "color",
    "passedCount", "totalCount"                   // member milestones
  } | null,
  "counts": { "past", "future", "total" }
}
```

The schema already carries `prev` and `currentChapter` so the Today and Current
Chapter widgets are **drop-in** later with no bridge changes.

### Refresh strategy

Relative labels are date-sensitive, so a single update source isn't enough:

- **Immediate** — web app pushes on data change (debounced ~1s) and on backgrounding
  (`visibilitychange`).
- **Daily** — `WidgetRefreshWorker` (WorkManager) re-renders at local midnight so
  countdowns roll over even when the app is never opened; each run re-schedules the next.
- **Backstop** — placed widgets render from the last stored snapshot, which survives
  reboot (SharedPreferences persists).

Both the plugin and the worker refresh via the same `ACTION_APPWIDGET_UPDATE`
broadcast, which makes the Glance receiver recompose and re-read the snapshot.

### Deep-linking (widget tap → milestone)

Tap launches `MainActivity` with the milestone id as a Glance ActionParameter
(surfaced as an Intent extra keyed `widget_milestone_id`). `MainActivity` stashes it
in `SharedPreferences`; on resume the web layer calls `consumeLaunchTarget()` and
`TimelineView` centers + opens that milestone.

### Build setup

Adds **Kotlin + Compose + Jetpack Glance** to the previously Java-only Android module.
Kotlin/Java JVM targets aligned to **21** (Capacitor forces Java 21). `java.time` used
for date math via **core library desugaring** (minSdk 24). Versions in
`android/variables.gradle` (`kotlinVersion`, `glanceVersion`).

---

## Status

### ✅ Phase 1 — Data bridge
- `src/utils/widgetSnapshot.js` (+ `widgetSnapshot.test.js`, 9 tests)
- `src/native/widgetBridge.js`, `WidgetBridgePlugin.java`
- `App.jsx` push hook; `MainActivity.java` plugin registration + deep-link handoff
- `TimelineView.jsx` consumes launch target

### ✅ Phase 2 — Next Milestone widget
- `NextMilestoneWidget.kt` (Glance, dark/amber/monospace, responsive compact + tall)
- `WidgetRefreshWorker.kt` (midnight tick)
- Manifest receiver + `res/xml/next_milestone_widget_info.xml`

Shipped in PR #166 (merged). Glance API fixes in PR #167.

> ⚠️ The Gradle/Kotlin compile cannot run in the Claude Code sandbox (Maven/Google
> repos blocked). The native module must be built locally (`npm run android`).

---

## Roadmap

### ⏳ Today widget
Today's date, day of week, and age (from `lifeglance-birthday` via `ageAtDate`).
**Largest size** also shows most-recently-passed + next-upcoming milestones and the
current chapter name. Data already in the snapshot (`prev`, `next`, `currentChapter`,
`birthday`).

### ⏳ Current Chapter widget
The chapter spanning today: name, how far into it you are (elapsed vs. total span),
and milestones passed / total. Data already in the snapshot (`currentChapter`).

### ⏳ iOS widgets
WidgetKit + a matching native bridge. The snapshot builder is platform-agnostic and
reusable; only the native widget layer differs.

### 💡 Deferred / ideas
- **Mini-timeline strip** — a rendered slice of the timeline around today. Highest
  "wow," hardest (native canvas or a cached bitmap from the web app). Deferred by
  decision.
- **On This Day** — milestones from this date in past years (feature already exists in
  `OnThisDayModal.jsx`); would need a small snapshot addition.
- **Pinned countdown** — user picks one milestone via a config Activity.
- **Quick-add button** — 1×1 launcher deep-linking into "New milestone" (`N`).
- **Stats / life-in-weeks** — counts already in the snapshot.

---

## Key files

| Area | Path |
|---|---|
| Snapshot builder | `src/utils/widgetSnapshot.js` (+ `.test.js`) |
| JS bridge | `src/native/widgetBridge.js` |
| Web hooks | `src/App.jsx`, `src/components/timeline/TimelineView.jsx` |
| Capacitor plugin | `android/app/src/main/java/com/lifeglance/app/WidgetBridgePlugin.java` |
| Activity wiring | `android/app/src/main/java/com/lifeglance/app/MainActivity.java` |
| Widget | `android/app/src/main/java/com/lifeglance/app/widget/NextMilestoneWidget.kt` |
| Data/format | `android/app/src/main/java/com/lifeglance/app/widget/WidgetData.kt` |
| Refresh | `android/app/src/main/java/com/lifeglance/app/widget/WidgetRefreshWorker.kt` |
| Manifest / provider | `AndroidManifest.xml`, `res/xml/next_milestone_widget_info.xml` |
| Build | `android/variables.gradle`, `android/build.gradle`, `android/app/build.gradle` |
