# lifeGLANCE Native Features Roadmap

Status: planning doc, not a spec. Intended as shared context for implementation work.

Last trued up against the tree: **31 October 2026**, at the point the iOS app
was readied for App Store submission. The two rounds before that shipped
without updating this file, so treat an un-dated claim here with suspicion and
check `MainViewController.swift` / `MainActivity.java` for what is actually
registered.

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

**Update (Oct 2026): blobs are no longer stranded.** `src/blobs/` now carries
media through GLANCEvault — `blobTransport.js` (encrypt → existence-check →
resumable upload → finalize, and download → decrypt), `blobCrypto.js`,
`thumbnail.js`, `milestoneMedia.js`, and `mediaBackfill.js` to migrate the
existing local-only library. New attachments round-trip on save; the local
IndexedDB store stays as source and fallback. Crypto stayed in the one shared
JS path, as this document required.

That closes the sync half of the byte plane. It does **not** close the native
half: the blob store is a JS/network client, so Swift and Kotlin still cannot
read media bytes. See *Blocked* below, where the blocker has changed shape.

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

**Answered (Oct 2026): it is reusable, and three surfaces now ride on it.** On
iOS the App Group store behind `WidgetBridgePlugin` feeds the widgets, carries
the `pending_target` / `pending_action` contract that `SceneDelegate` writes and
`consumeLaunchTarget()` drains, and is the path a tapped Spotlight result and
the add-a-milestone App Intent both take. On Android the equivalent is
`WidgetData.kt`. Extend that contract for a new surface rather than growing a
parallel bridge.

---

## Done

| Feature | Platforms |
|---|---|
| Widgets | Android (Jetpack Glance, 10 providers) + iOS (WidgetKit, 11 widgets) |
| Share targets | Both |
| Ambient / watch mode | Both (keep-awake + auto-run) |
| Lock Screen widget families | iOS (accessory circular / rectangular / inline) |
| App Intents: add-a-milestone | iOS (Siri + Shortcuts) |
| Quick Settings tile, long-press shortcuts | Android |
| **Photo Picker** | Android (`MediaPickerPlugin.kt`) |
| **SAF `ACTION_OPEN_DOCUMENT`** | Android (same plugin, audio/video) |
| **Core Spotlight** | iOS (`SpotlightPlugin.swift` + `src/utils/spotlightIndex.js`) |
| **Zero-config iCloud sync** | iOS (`ICloudPlugin.swift`, `docs/icloud-sync.md`) |
| **Direct Access folder/file sync** | Both (`docs/direct-access.md`) |
| **Secure store / device verification** | Both (`docs/secure-store-device-verification.md`) |
| **Vault SSE** | Both |
| **Store billing** | Android (Play) + iOS (RevenueCat / StoreKit 2) |
| **UIScene lifecycle** | iOS (required by the iOS 27 SDK; without it the app is killed at launch) |

The bolded rows all landed after this table was last written. Registered
plugins are the ground truth: seven on iOS (`MainViewController.swift`) and
seven on Android (`MainActivity.java`).

The Lock Screen families and the App Intent are device-verified. The camera
path is **not**: `NSCameraUsageDescription` / `NSMicrophoneUsageDescription`
were added to `Info.plist` in Oct 2026 because WKWebView's `<input type=file>`
capture runs in-process and terminates the app without them, but that has only
been reasoned from the code — the Simulator has no camera. Verify on hardware.

**iOS now targets 16.0** (raised from 15.0), which the Lock Screen families and
the App Intent both required. Worth
knowing before planning further iOS work: anything gated on iOS 16 is now free,
and StandBy (17+) is the next threshold if it is ever wanted — though it stays
explicitly skipped below.

### Share targets — the iOS asymmetry is permanent

Android's share target opens the app; iOS's cannot, and that is not a gap to
close later. App extensions are barred from opening URLs, the responder-chain
`openURL:` technique died in iOS 18, and Apple is explicit that this is by
design. The iOS extension confirms in place and the draft waits for the next
launch. Full reasoning in `docs/ios-share-extension-spec.md` §3a; do not re-open
it as a bug.

---

## Ready to build (no blockers)

| Feature | Platform | Notes |
|---|---|---|
| Material You / Monet theming | Android | Wallpaper-derived palette. Makes a personal timeline feel personal. Still unbuilt: the app runs on a plain `AppTheme` with no `DynamicColors` call. |

The Photo Picker and SAF entries that used to sit here **shipped** — see *Done*.

### Photo Picker: what shipped

As specified. `MediaPickerPlugin.kt` fires the ActivityResult contracts and
hands the URI back; `WebChromeClient.onShowFileChooser` was not intercepted. No
`READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` is declared and there is no permission
prompt. `Capacitor.convertFileSrc()` carries the bytes as a stream rather than
base64.

The JS side is `src/native/mediaPicker.js`, whose return contract distinguishes
"no native picker here" (`null`) from "user cancelled" (`{ cancelled: true }`),
so web and iOS fall through to the hidden `<input type="file">` unchanged.

**That fall-through has an iOS consequence worth knowing**, because it is not
obvious from either side: iOS registers no `MediaPicker`, so every iOS attach
goes through the raw file input, whose action sheet offers "Take Photo or
Video" — an in-process capture. That is why iOS needs camera and microphone
usage strings in `Info.plist` and Android does not. Guarded by
`src/native/mediaCaptureIosParity.test.js`; if an iOS picker is ever added,
that test fails and points at this reasoning.

### App Intents scoping — shipped as specified

iOS v1.0 was deliberately **minimal**: declare the intent, stop there. No parameterized intents, no Shortcuts chaining. That is what shipped — one `AddMilestoneIntent` plus an `AppShortcutsProvider`, in `ios/App/App/AddMilestoneIntent.swift`.

Rationale for the platform asymmetry (rich automation on Android, minimal on iOS): on Android, Tasker speaks the same intent surface already declared for app-to-app interop, so automation depth is close to free. On iOS there is no Tasker, so equivalent depth means hand-building parameterized Shortcuts surfaces. Different ecosystems warrant different depths. This is not an inconsistency.

The intent reuses the Quick Add widget's contract rather than adding a second one: it writes `"new"` to the App Group's `pending_action`, which the existing `consumeLaunchTarget()` path turns into the Add-milestone sheet. Any future intent should follow that shape — extend the projection/action contract, don't grow a parallel bridge.

**Widening this is a real decision, not a follow-up.** Parameterized intents mean modelling milestones as `AppEntity`, which is a materially larger surface than what is here.

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

None of the above has landed as of Oct 2026, with one partial: `WorkManager`
is in the tree but only to refresh widgets (`WidgetRefreshWorker.kt`), not as a
sync scheduler. There is no `BGTaskScheduler`, no associated-domains or
`autoVerify` app-links entry on either platform, and no biometric lock.

**Two intent surfaces, not one.** Keep a signature-permission **trusted** channel that only co-signed GLANCE apps can fire, and a separate **lower-privilege** automation surface for Tasker (forgeable by design, simple commands). Given the dedup/`transitionId` integrity history, do not let any app that learns the action strings forge events into the trusted stream.

---

## Blocked on GLANCEvault (byte plane)

**The blocker has changed shape.** GLANCEvault's blob store landed (see
*Metadata plane vs byte plane* above), so media now syncs and thumbnails are
generated. What is still missing is a way for **native** code to read those
bytes: `src/blobs/` is a JS/network client, and a widget or provider cannot
call it.

So these three no longer wait on a blob store existing. They wait on a native
bridge to the one that does.

| Feature | Platform | Why still blocked |
|---|---|---|
| DocumentsProvider | Android | Needs native byte ownership. A `ContentProvider` can be queried while the app is backgrounded, and you cannot reliably drive a headless WebView to fetch blobs on demand. |
| File Provider extension | iOS | Same wall. iOS twin of DocumentsProvider. |
| Photos / thumbnails in widgets | Both | Widgets render text and dates only. Confirmed: no widget on either platform reads user media — the only images anywhere in the widget targets are SF Symbols (`Image(systemName:)`) for the Lock Screen accessories. |

The widget case is now the cheapest of the three and no longer needs the full
abstraction: thumbnails already exist (`src/blobs/thumbnail.js`), and the
projection store is already a native-readable mirror the WebView keeps fresh.
Writing decrypted thumbnail bytes into the App Group / app-private directory
alongside the projection would put photos in widgets without any provider work.
The cost is decrypted media at rest outside IndexedDB, which is a privacy
decision rather than an engineering one, and should be made deliberately.

### The eventual shape

**Partly built.** The GLANCEvault blob client in `src/blobs/` is the network
half of this and is content-addressed, so it already behaves like `getBytes` /
`putBytes` / `has` over the wire. What is described below is still the right
shape for the *native* half, which does not exist.

A byte-source abstraction mirroring the `GlanceTransport` pattern: `getBytes(id)`, `putBytes(id, stream)`, `has(id)`, `delete(id)`. The sync and encryption pipeline depends only on the interface.

- PWA / Docker implementation: IndexedDB or OPFS backed (today's behavior, formalized)
- Android implementation: native filesystem backed

Constraint that forces this shape: the self-hosted browser-only deployment has no native layer, so **the JS/browser path must always be able to own media**. Native can be an owner where one exists, never the only owner.

Crypto stays in the one shared JS path. Do not reimplement and re-audit AES-GCM in Kotlin or Swift. Bytes pass through JS to be encrypted at sync time regardless of where they rest; `convertFileSrc` makes that bridge crossing cheap.

The `documentId` scheme lines up naturally with the existing `media_id` / `photo_id` / `thumbnail_id` slots on the milestone entity. `openDocument` becomes the same hook whether materializing local bytes or pull-and-decrypt from the blob store.

Two pre-existing problems this also fixes (both blob-store shaped, not wrapper shaped): media stranded on the originating device, and the base64-in-JSON backup path failing on sizable video.

Status of those two: **the first is fixed** by the blob store — media reaches
other devices, and `mediaBackfill.js` migrates libraries that predate it. The
second is sidestepped rather than solved: audio and video are simply excluded
from the JSON backup, which README states, so a restore still loses
attachments. A blob-aware export is the real fix and is not built.

---

## Later / optional

Core Spotlight has moved out of this table and into *Done* — it shipped as
described, a read-only consumer of the projection store.

| Feature | Platform | Notes |
|---|---|---|
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

The previous edition sent the centre of gravity to Android on the strength of
the Photo Picker and SAF. Both shipped, and so did Core Spotlight, iCloud sync,
Direct Access, billing and the UIScene adoption. So the board has moved a long
way since this file was last true, and the shortlist is now short.

What is actually left, in rough order of value per unit of work:

1. **Photos in widgets (both).** The most visible remaining gap in a memory
   app, and much cheaper than it was: thumbnails exist and the projection store
   is already a native-readable mirror, so this needs decrypted thumbnail bytes
   written beside the projection rather than any provider work. It carries one
   real decision — decrypted media at rest outside IndexedDB — which should be
   made deliberately rather than discovered in review.
2. **Material You / Monet (Android).** The last item on the old ready-to-build
   list, still unbuilt, still zero architectural risk.
3. **BGTaskScheduler / WorkManager sync (both).** Called the highest-leverage
   cross-cutting win when this file was written, and nothing since has
   contradicted that. `WidgetRefreshWorker` shows the Android plumbing already
   works; the gap is using it for sync rather than widget refresh.

Not on the list, deliberately: DocumentsProvider and the File Provider
extension. Both still need native byte ownership, and neither is worth building
before the cheaper widget-photo path has proved out how native reads blob bytes.

### Before the next slice, verify on hardware

Carried over from the App Store readiness pass and not yet done: the iOS camera
and microphone capture path. The usage strings are in `Info.plist` and a test
guards them, but the crash they prevent has only been reasoned about — neither
CI nor the Simulator can reach it. Attach a photo via "Take Photo", and attach
media via video capture, on a real device.
