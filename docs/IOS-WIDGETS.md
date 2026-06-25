# iOS Widgets — Setup

The iOS widgets (WidgetKit + SwiftUI) reuse the exact same snapshot the web app
already produces. All Swift/plist/entitlements are written and committed; what remains
is the Xcode wiring that genuinely can't be scripted without risking the
`project.pbxproj` (creating an app-extension target, App Group capability, file target
membership). Do these once in Xcode.

> Bundle id: `com.lifeglance` · App Group: `group.com.lifeglance` ·
> Extension bundle id: `com.lifeglance.LifeGlanceWidgets`

## Architecture (how it differs from Android)

The widget runs in a **separate extension process**, so unlike Android (same-process
SharedPreferences) it cannot read the app's storage directly. The app and the extension
share data through an **App Group** container (`UserDefaults(suiteName:)`). The
`WidgetBridge` plugin writes the snapshot there and calls
`WidgetCenter.reloadAllTimelines()`; the widgets read it via `WidgetStore`.

Everything else mirrors Android: raw ISO dates in the snapshot, relative labels
computed at render time, a midnight timeline-reload boundary, and a widget-tap deep
link (`lifeglance://milestone?id=…`) that `AppDelegate` stashes for the web layer's
existing `consumeLaunchTarget()` flow.

## Files already committed

Extension (`ios/App/LifeGlanceWidgets/`):
- `WidgetModel.swift` — snapshot model, `WidgetStore` (App Group), date/label helpers
  **(also add to the App target — the plugin uses `WidgetStore`)**
- `WidgetTheme.swift` — palette, `Color(hex:)`, `widgetBackground`
- `WidgetProvider.swift` — `SnapshotProvider` (TimelineProvider) + entry
- `WidgetViews.swift` — the three SwiftUI views
- `LifeGlanceWidgetsBundle.swift` — `@main` bundle + the three widget configs
- `Info.plist`, `LifeGlanceWidgets.entitlements`

App target (`ios/App/App/`):
- `WidgetBridgePlugin.swift` — the iOS `WidgetBridge` Capacitor plugin
- `App.entitlements` — App Group for the main app
- `AppDelegate.swift` — parses the widget deep link (already edited)
- `Info.plist` — `lifeglance` URL scheme (already added)

## Xcode steps

> **First, from the repo root:** `npm run build:ios`. This builds the web bundle and
> runs `cap sync ios` to stage it (and Capacitor plugins) into the native project — a
> prerequisite, not part of the Xcode build below. It does **not** compile the app or
> touch the widget extension target, and is safe to re-run. Run it again whenever you
> change **web** code; pure Swift/widget changes only need an Xcode rebuild.

1. **Open** `ios/App/App.xcworkspace`.

2. **App Group on the App target** — select the **App** target → *Signing &
   Capabilities* → **＋ Capability → App Groups** → add `group.com.lifeglance`. Point its
   *Code Signing Entitlements* at the committed `App/App.entitlements` (or let Xcode
   manage and confirm the group matches).

3. **Create the extension** — *File → New → Target… → Widget Extension*. Name it
   **`LifeGlanceWidgets`**; **uncheck** "Include Live Activity" and "Include
   Configuration App Intent" (we use `StaticConfiguration`). Click *Activate*. **Delete
   the template `.swift` file Xcode generates** (it has its own `@main`, which would
   collide).

4. **Add the committed files to the extension target** — drag the five
   `ios/App/LifeGlanceWidgets/*.swift` files in; set target membership to
   **LifeGlanceWidgets**. Use the committed `Info.plist` and
   `LifeGlanceWidgets.entitlements` for the target (set *Info.plist File* and *Code
   Signing Entitlements* build settings). Add the **App Groups** capability to this
   target too (`group.com.lifeglance`).

5. **Shared + app files** — set `WidgetModel.swift` to be a member of **both**
   LifeGlanceWidgets **and** App. Add `WidgetBridgePlugin.swift` to the **App** target.

6. **Deployment target** — set the extension to **iOS 16+**.

7. **Build & run**, then long-press the home screen → **＋** → search *lifeGLANCE* →
   add any of the three widgets.

## Signing & distribution — do I need App Store Connect?

**No new App Store Connect setup is required for the widgets.** Two different Apple
sites are involved, and only the first matters here:

- **Apple Developer portal** (developer.apple.com → *Certificates, Identifiers &
  Profiles*) — where the extension's **App ID** (`com.lifeglance.LifeGlanceWidgets`) and
  the **App Group** (`group.com.lifeglance`) are registered, with the App Group enabled
  on **both** the app's and the extension's App IDs. With Xcode's *Automatically manage
  signing* (the default), **Xcode does all of this for you** when you add the App Groups
  capability in steps 2 and 4 — it registers the group, creates the extension App ID,
  and regenerates provisioning profiles. You only touch the portal by hand if you use
  **manual signing**, in which case register the App Group there and enable it on both
  App IDs, then update the distribution profiles.

- **App Store Connect** (appstoreconnect.apple.com) — app records, TestFlight, builds.
  A widget extension is **embedded inside the existing app's build**, so there is **no
  separate app or extension record to create** here. Nothing widget-specific to
  configure. When you're ready to test on real devices beyond your own, upload a build
  to **TestFlight** exactly as you would any release; the widget ships inside it.
  (TestFlight is the iOS equivalent of Play's internal test track.)

Local simulator / personal-device testing needs **none** of the above beyond the Xcode
steps — automatic signing provisions the App Group on the fly.

## Notes

- Widgets show empty states until the app has run once and pushed a snapshot.
- `npx cap sync ios` is safe to run; it copies web assets and won't remove the target.
- No JS changes: `src/native/widgetBridge.js` already calls the `WidgetBridge` plugin
  (the Swift `jsName` matches), and `src/utils/widgetSnapshot.js` is the single source
  of the snapshot for both platforms.

## Registering the WidgetBridge plugin (required)

Capacitor auto-discovers plugins that ship as packages, but **not** plugins defined
inside the app — so `WidgetBridge` reports *"plugin is not implemented on ios"* until
it's registered explicitly. `MainViewController.swift` does this via the documented
`capacitorDidLoad()` hook:

```swift
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WidgetBridgePlugin())
    }
}
```

Add that file to the **App** target, then in **Main.storyboard** set the bridge view
controller's **Custom Class** to `MainViewController` (Identity Inspector). Without
this, snapshots never reach the App Group and every widget shows its empty state.
