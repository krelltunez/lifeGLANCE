# lifeGLANCE Native Features Roadmap

Status: planning doc, not a spec. Intended as shared context for implementation work.

Scope: native platform features for the lifeGLANCE Capacitor builds (Android + iOS). Both platforms already build and run.

---

## Architectural context

Two ideas drive everything below. Worth reading before the tables.

### 1. Metadata plane vs byte plane

lifeGLANCE media (photos, audio, video) currently lives in IndexedDB:

- Database `lifeglance`, object store `media`
- Photo key: `${milestone_id}-photo`
- Audio/video key: `${milestone_id}` (same as `media_id`)
- Stored as `{ id, blob, mimeType }` tuples
- Relevant code: `src/data/db.js` (`dbPutPhoto`, `dbGetPhoto`, `dbPutMedia`, `dbGetMedia`), `src/data/milestones.js` (schema fields `has_photo`, `media_type`, `media_id`, `photo_id`), `src/components/timeline/TimelineView.jsx` (upload + persist on save)
- Only metadata syncs. Blobs are stranded on the originating device.

Native code cannot read IndexedDB. This splits native features cleanly:

- **Metadata plane** features operate on IDs, dates, titles, and computed state. They work today. This is most of the list.
- **Byte plane** features need native to read raw media bytes. These are blocked until GLANCEvault provides a `MediaStore` / `BlobProvider` abstraction with a native-filesystem-backed implementation.

The byte plane is a GLANCEvault problem, not an Android/iOS wrapper problem. It does not block the native feature work.

### 2. The projection store

Native surfaces that render or act **outside** the WebView (widgets, tiles, notifications, wallpaper) cannot read IndexedDB. They read a native-readable mirror that the WebView keeps fresh.

```
WebView (source of truth, IndexedDB)
    -> projection store (native-readable copy)
        -> widget / tile / notification (render)
```

- Android: SharedPreferences for scalar state, Room table or flat JSON file for list-shaped data
- iOS: App Group shared container (`UserDefaults(suiteName:)` or a JSON file in the container)

It is infrastructure, not a feature. Nobody sees it. Every read-side native surface depends on it.

**lifeGLANCE projects:** flat milestone list (date, title, Life/Chapter ref), the Chapter set, computed "current Chapter." Text and dates only for now (photos are byte plane).

**Two write-side disciplines, both from prior bugs:**

1. The projection write hangs off the same debounced on-change hook as push-on-write, but **must also flush on `visibilitychange` / `pagehide`**. Background-tab timer throttling can prevent a debounced flush from firing. A stale projection when the user pulls down a widget is that bug in a new costume.
2. Any native-originated mutation (write-back from a notification or intent) **stamps a stable `transitionId` at the native mutation point** and the JS drain **preserves** it, never regenerates it. Re-stamping on drain produces duplicate events across devices.

Note: since widgets are already shipped, some form of projection store already exists. Worth confirming whether it is a deliberate reusable plugin or something narrower built just to feed the widget, before the next surface lands on it.

---

## Done

| Feature | Platforms |
|---|---|
| Widgets | Android (Jetpack Glance) + iOS (WidgetKit) |
| Share targets | Both |
| Ambient / watch mode | Both (keep-awake + auto-run, already present) |

---

## Ready to build (no blockers)

| Feature | Platform | Notes |
|---|---|---|
| Photo Picker | Android | Permission-free image/video import. Works today despite IndexedDB media because import is foreground and one-shot. |
| SAF `ACTION_OPEN_DOCUMENT` | Android | Audio import. Photo Picker is visual-only. Also permission-free. |
| Lock Screen / StandBy widget families | iOS | Nearly free once WidgetKit widgets exist. Same projection, different widget families. |
| Material You / Monet theming | Android | Wallpaper-derived palette. Makes a personal timeline feel personal. |
| App Intents: add-a-milestone | iOS | The minimal iOS v1.0 intent. Yields Siri + Shortcuts for that one action. |

### Photo Picker implementation note

Capacitor-idiomatic path: do **not** intercept `WebChromeClient.onShowFileChooser`. Instead call a native plugin (Camera/Gallery plugin, or a thin custom one) that fires the `PickVisualMedia` / `PickMultipleVisualMedia` ActivityResult contract and hands the URI back to JS.

- No `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` declared, no permission prompt
- The URI grant is temporary and scoped. Copy bytes into app-owned storage immediately.
- Use `Capacitor.convertFileSrc()` so JS can `fetch(url).then(r => r.blob())` straight into `dbPutMedia`. Avoids ~33% base64 inflation, which matters for video.
- The existing web storage path is unchanged. It just receives URIs from a nicer picker.

### App Intents scoping

iOS v1.0 is deliberately **minimal**: declare the intent, stop there. No parameterized intents, no Shortcuts chaining.

Rationale for the platform asymmetry (rich automation on Android, minimal on iOS): on Android, Tasker speaks the same intent surface already declared for app-to-app interop, so automation depth is close to free. On iOS there is no Tasker, so equivalent depth means hand-building parameterized Shortcuts surfaces. Different ecosystems warrant different depths. This is not an inconsistency.

---

## Cross-cutting (suite-wide, not lifeGLANCE-specific)

Listed for completeness. These apply to all three GLANCE apps.

| Feature | Platform | Notes |
|---|---|---|
| WorkManager / BGTaskScheduler background sync | Both | Reliable scheduled sync with constraints and backoff. Highest leverage native win. |
| Native intent transport | Android | Same-device GLANCE-to-GLANCE interop over Binder IPC. A second `GlanceTransport` implementation, not a new protocol. Falls back to WebDAV cross-device. |
| Tasker / automation surface | Android | Same declaration as app-to-app interop. Near-free. |
| Verified App Links / Universal Links | Both | |
| BiometricPrompt / Face ID app lock | Both | |
| Splash screen, predictive back, per-app language | Both | Native polish. Per-app language ties to the i18n work. |

**Two intent surfaces, not one.** Keep a signature-permission **trusted** channel that only co-signed GLANCE apps can fire, and a separate **lower-privilege** automation surface for Tasker (forgeable by design, simple commands). Given the dedup/`transitionId` integrity history, do not let any app that learns the action strings forge events into the trusted stream.

---

## Blocked on GLANCEvault (byte plane)

All three unblock together when `MediaStore` / `BlobProvider` lands.

| Feature | Platform | Why blocked |
|---|---|---|
| DocumentsProvider | Android | Needs native byte ownership. A `ContentProvider` can be queried while the app is backgrounded, and you cannot reliably drive a headless WebView to fetch blobs from IndexedDB on demand. |
| File Provider extension | iOS | Same wall. iOS twin of DocumentsProvider. |
| Photos / thumbnails in widgets | Both | Widgets can show text and dates only until native can read media bytes. |

### The eventual shape

A byte-source abstraction mirroring the `GlanceTransport` pattern: `getBytes(id)`, `putBytes(id, stream)`, `has(id)`, `delete(id)`. The sync and encryption pipeline depends only on the interface.

- PWA / Docker implementation: IndexedDB or OPFS backed (today's behavior, formalized)
- Android implementation: native filesystem backed

Constraint that forces this shape: the self-hosted browser-only deployment has no native layer, so **the JS/browser path must always be able to own media**. Native can be an owner where one exists, never the only owner.

Crypto stays in the one shared JS path. Do not reimplement and re-audit AES-GCM in Kotlin or Swift. Bytes pass through JS to be encrypted at sync time regardless of where they rest; `convertFileSrc` makes that bridge crossing cheap.

The `documentId` scheme lines up naturally with the existing `media_id` / `photo_id` / `thumbnail_id` slots on the milestone entity. `openDocument` becomes the same hook whether materializing local bytes or pull-and-decrypt from the blob store.

Two pre-existing problems this also fixes (both blob-store shaped, not wrapper shaped): media stranded on the originating device, and the base64-in-JSON backup path failing on sizable video.

---

## Later / optional

| Feature | Platform | Notes |
|---|---|---|
| Core Spotlight + `NSUserActivity` | iOS | Read-only consumer of the projection. System search into a life timeline is a strong fit. Obvious first v1.1 addition. |
| Watch mode as Dream Service | Android | A Dream Service is a full custom window (unlike a widget) and can host a WebView, so watch mode could run as a true charging-triggered system screensaver. Real net-new reach; no iOS equivalent. Lifecycle is fiddly and spinning up a WebView with full web context inside a Dream is heavyweight. |
| Live / interactive wallpaper | Android | On-this-day or slow timeline scroll. |
| Journaling Suggestions | iOS | Distinctive import funnel for a memory app. iOS-only, use-case-gated, privacy-walled (only what the user picks). |
| Android print framework | Android | Export-as-artifact path. Explicitly not soon. |

### Explicitly skipped

- **StandBy (as a host for watch mode)**, iOS. Three independent blockers: WidgetKit cannot render a WebView (watch mode is CSS/JS, so it would need a full native reimplementation); the widget refresh budget is roughly dozens of reloads per day, which cannot drive continuous animation; and the photos are byte-plane stranded. The in-app ambient mode already delivers the actual experience.
- **Live Activities / Dynamic Island**, iOS. Built for time-sensitive ongoing events. lifeGLANCE has no real-time dimension. No honest fit.
- **App Clips**, iOS. Built around discovery and transactions for account-based services. A no-account, local-first app has nothing for an App Clip to do.

---

## Ambient / watch mode notes

Already implemented (keep-awake + auto-run). Two things worth being deliberate about before it ships widely, since they surface only after the feature has been running a while:

- **Battery.** A keep-awake mode that auto-runs defeats the screen timeout by design. Gating auto-run on `isCharging` (Capacitor Device API) handles this and mirrors how StandBy behaves.
- **OLED burn-in.** Slow-moving content plus persistent chrome is the classic burn-in profile. Ken Burns motion protects the photos. Any **fixed** UI elements (static header, progress bar sitting in the same pixels for a long session) are the exposure, and would want to drift or fade.

---

## Suggested next slice

Given widgets and share targets are done:

1. **Photo Picker (Android).** Real user-facing win, removes a scary permission prompt, zero architectural risk, no byte-plane dependency.
2. **Lock Screen / StandBy widget families (iOS).** Nearly free reuse of the WidgetKit work just completed.

Neither touches the blocked byte plane. Both are cheap.
