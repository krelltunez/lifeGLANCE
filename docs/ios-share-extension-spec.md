# iOS Share Extension — implementation spec

Status: **implemented** — all sections below are built and registered in
`App.xcodeproj`. Retained as the design record for the "share text/link →
pre-filled Add-milestone sheet" flow on iOS, matching what Android already does.
Where the shipped code deliberately departs from the original sketch, the section
says so. Still **unverified on a device** — see *Acceptance tests*.

## Goal

Let a user share plain text or a link from any app (Safari, Notes, Messages, …)
into lifeGLANCE and land on the Add-milestone sheet pre-filled from the shared
content — the same behaviour Android ships today.

## How the share flow works today

The web layer is already cross-platform and needs **no changes**:

- `src/components/timeline/TimelineView.jsx` calls `consumeWidgetLaunchTarget()` on
  resume; when it gets `{ share: { text, subject } }` it runs `shareToMilestoneDraft()`
  (`src/native/shareDraft.js`) and opens the Add sheet seeded with the resulting
  `{ title, url, note }`.
- `src/native/widgetBridge.js` → `consumeWidgetLaunchTarget()` already reads a
  `res.share` field and `JSON.parse`s it into `{ text, subject }`.

Android supplies that `share` field like this:

- `AndroidManifest.xml` declares an `ACTION_SEND` / `text/plain` intent-filter on
  `MainActivity`.
- `MainActivity.handleShareIntent()` reads `EXTRA_TEXT` / `EXTRA_SUBJECT`, builds a
  `{ text, subject }` JSON string, and writes it to `SharedPreferences` under
  `WidgetData.KEY_PENDING_SHARE` (`"pending_share"`).
- `WidgetBridgePlugin.consumeLaunchTarget()` returns it as `ret.put("share", …)`,
  then clears it.

**The data contract the native side must satisfy** is therefore exactly:

> `consumeLaunchTarget()` resolves an object that may contain `share`, a JSON
> **string** of the form `{"text": "…", "subject": "…"}` (either key optional).
> It is cleared once read.

## Why iOS needs a Share Extension

On iOS an app cannot appear in the system share sheet via a URL scheme or from the
main app target. Participating in the share sheet requires a dedicated **Share
Extension** target. The extension runs in its own process, receives the shared
items, and — because it can reach the app's **App Group** container — can hand the
payload to the main app using the identical `pending_share` mechanism the widgets
already use.

We deliberately reuse the existing App Group `group.com.lifeglance` and the
`WidgetStore` pending-key pattern, so the iOS `share` path is a mirror of Android's
with no new storage concepts.

## Components & changes

### 1. New target: `LifeGlanceShare` (Share Extension)

- Product name `LifeGlanceShare`, bundle identifier `com.lifeglance.share`,
  `IPHONEOS_DEPLOYMENT_TARGET = 15.0` and `MARKETING_VERSION = 3.0.0` to match
  the `App` and widgets targets.
- No storyboard — this extension has **no UI** (it processes and dismisses
  immediately, matching Android's silent stash-and-open), so activation goes
  through `NSExtensionPrincipalClass`.
- **App Groups** capability with `group.com.lifeglance`, in
  `ios/App/LifeGlanceShare/LifeGlanceShare.entitlements`:
  ```xml
  <key>com.apple.security.application-groups</key>
  <array><string>group.com.lifeglance</string></array>
  ```

Two departures from the original sketch, both deliberate:

- **The target was hand-written into `project.pbxproj`**, not created through
  Xcode's *New Target* assistant. The project is `objectVersion = 70`, so the
  target hangs off a `PBXFileSystemSynchronizedRootGroup` — there are no
  per-file build entries, which makes the edit small and reviewable, and the
  `LifeGlanceWidgetsExtension` target next to it serves as the reference shape.
  Signing is `Automatic` against the existing `DEVELOPMENT_TEAM`, so nothing had
  to be provisioned by hand.
- **`WidgetModel.swift` is *not* added to this target's membership.**
  `ShareViewController` writes to `UserDefaults(suiteName:)` inline instead, the
  same self-contained approach `AppDelegate` uses. Sharing one file across two
  synchronized-folder targets requires a `membershipExceptions` entry, which is
  more machinery than a three-line write is worth. §4's `WidgetStore` additions
  are still needed — but only for the **App** target's read side (§5).

### 2. `LifeGlanceShare/Info.plist` activation rule

Accept plain text and a single web URL / web page (Safari page shares also carry a
title we can use as `subject`):

```xml
<key>NSExtension</key>
<dict>
  <key>NSExtensionPointIdentifier</key>
  <string>com.apple.share-services</string>
  <key>NSExtensionPrincipalClass</key>
  <string>ShareViewController</string>
  <key>NSExtensionAttributes</key>
  <dict>
    <key>NSExtensionActivationRule</key>
    <dict>
      <key>NSExtensionActivationSupportsText</key><true/>
      <key>NSExtensionActivationSupportsWebURLWithMaxCount</key><integer>1</integer>
      <key>NSExtensionActivationSupportsWebPageWithMaxCount</key><integer>1</integer>
    </dict>
  </dict>
</dict>
```

The principal class is the **bare** `ShareViewController`, not
`$(PRODUCT_MODULE_NAME).ShareViewController` as first sketched. The class is
declared `@objc(ShareViewController)`, which overrides its Objective-C runtime
name to drop the module prefix; the system resolves this key through
`NSClassFromString`, so the module-qualified form would not resolve and the
extension would fail to launch. The two must be changed together.

### 3. `LifeGlanceShare/ShareViewController.swift`

Responsibilities: pull text/URL/title from the extension context, build the
`{ text, subject }` payload, write it to the App Group, foreground the host app,
and complete the request. Sketch:

```swift
import UIKit
import Social
import UniformTypeIdentifiers

@objc(ShareViewController)
final class ShareViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        Task { await process(); complete() }
    }

    private func process() async {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }

        var text = ""
        var subject = ""

        for item in items {
            // The item's title (e.g. a Safari page title) maps to Android's EXTRA_SUBJECT.
            if subject.isEmpty, let t = item.attributedContentText?.string, !t.isEmpty {
                subject = t
            }
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    // Put the URL in `text` so shareToMilestoneDraft() extracts it,
                    // exactly like Android's EXTRA_TEXT usually carrying the link.
                    if text.isEmpty { text = url.absoluteString }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let s = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    text = s
                }
            }
        }

        guard !text.isEmpty || !subject.isEmpty else { return }

        var payload: [String: String] = [:]
        if !text.isEmpty { payload["text"] = text }
        if !subject.isEmpty { payload["subject"] = subject }
        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let json = String(data: data, encoding: .utf8) {
            WidgetStore.setPendingShare(json)
        }
    }

    private func complete() {
        // Bring the host app forward so it polls consumeLaunchTarget() on resume.
        openHostApp(URL(string: "lifeglance://share")!)
        extensionContext?.completeRequest(returningItems: nil)
    }

    // An extension can't call UIApplication.shared; walk the responder chain.
    private func openHostApp(_ url: URL) {
        var responder: UIResponder? = self
        let selector = sel_registerName("openURL:")
        while let r = responder {
            if r.responds(to: selector) { r.perform(selector, with: url); return }
            responder = r.next
        }
    }
}
```

> Note: the `openURL:` responder-chain hop is the standard way an extension
> foregrounds its host app. If a future iOS release removes it, fall back to
> completing the request without opening — the web layer still picks up
> `pending_share` the next time the app is opened manually.

### 4. `WidgetStore` additions (`WidgetModel.swift`)

Add a third pending key alongside the existing target/action ones:

```swift
static let keyPendingShare = "pending_share"   // JSON string { text, subject }

static func setPendingShare(_ json: String) {
    defaults?.set(json, forKey: keyPendingShare)
}

static func consumePendingShare() -> String? {
    guard let s = defaults?.string(forKey: keyPendingShare) else { return nil }
    defaults?.removeObject(forKey: keyPendingShare)
    return s
}
```

### 5. `WidgetBridgePlugin.consumeLaunchTarget` (App target)

Return the pending share so the JS bridge sees it — one added block, mirroring the
Android `ret.put("share", …)`:

```swift
if let share = WidgetStore.consumePendingShare() {
    result["share"] = share
}
```

### 6. `AppDelegate` (optional)

`lifeglance://share` needs no stashing (the extension already wrote `pending_share`),
so `handleWidgetDeepLink` can simply accept the host without action. Add a
`case "share": break` with a comment so the scheme is clearly handled rather than
silently hitting `default`.

## Data contract (must match Android/JS)

| Field    | Type            | Source                                   |
| -------- | --------------- | ---------------------------------------- |
| `share`  | JSON string     | `{"text": "…", "subject": "…"}` (either key optional) |
| `text`   | string          | shared plain text, or the shared URL     |
| `subject`| string          | page/item title (Android `EXTRA_SUBJECT`)|

`shareToMilestoneDraft()` extracts the first URL from `text`, prefers `subject` as
the title, and keeps the full text as a note — no iOS-side truncation needed.

## Edge cases

- **URL-only share (Safari):** put the URL into `text` (not a separate field) so the
  existing draft logic finds it; `subject` = page title.
- **Nothing usable:** complete the request without writing `pending_share`, so the
  app doesn't open a blank draft.
- **Images / files:** out of scope; the activation rule restricts to text/URL/page,
  so non-text attachments never reach us.
- **App Group sandbox:** the extension must use `UserDefaults(suiteName:)`, never
  `.standard`. `WidgetStore` already does this.

## Acceptance tests (manual — no iOS device CI)

`.github/workflows/ios.yml` compiles the extension, which catches project and
Swift errors, but it never runs the app — so nothing below is covered by CI.
All four remain outstanding:

1. Share plain text from Notes → app opens → Add sheet titled from the text.
2. Share a URL from Safari → Add sheet with the URL populated and hostname/title.
3. Share with an explicit subject/title → subject becomes the title.
4. Share something empty/unusable → app does not open a blank draft.

Test 0, implied by the rest: **lifeGLANCE actually appears in the share sheet.**
An activation-rule or principal-class error presents as a silently missing entry
rather than a crash, so confirm the entry exists before reading anything into
tests 1–4.

## Out of scope

- Rich-media (image/file) shares.
- A custom compose UI in the extension.
- Deriving the extension's `MARKETING_VERSION` from `package.json` (tracked
  separately with the App target — see the version-drift note in the iOS cleanup).
