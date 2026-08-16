# iOS Share Extension — implementation spec

Status: **implemented** — all sections below are built and registered in
`App.xcodeproj`. Retained as the design record for the "share text/link →
pre-filled Add-milestone sheet" flow on iOS, matching what Android already does.
Where the shipped code deliberately departs from the original sketch, the section
says so — most importantly §3a, where the "share opens the app" behaviour this
document was written around turned out to be prohibited by iOS and had to be
replaced. Partly device-verified; see *Acceptance tests*.

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
`{ text, subject }` payload, append it to the App Group queue, confirm to the user,
and complete the request.

> **The host app is never foregrounded.** The original sketch below ended by
> opening `lifeglance://share` via the responder chain. That does not work and
> cannot be made to — see *The auto-open leg* — so the shipped controller shows a
> confirmation sheet instead. Read that section before this sketch.

Sketch (retained as the design record; the auto-open half is obsolete):

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

### 3a. The auto-open leg — removed, and why it can't come back

The contingency the note above hedged on is now the permanent state, and the
cause is stronger than "a release removed it": **iOS bars app extensions from
opening URLs at all.** `UIApplication` is marked unavailable in extensions; the
`openURL:` responder-chain walk was a runtime end-run around that build-time
block, and iOS 18 closed it (`responds(to:)` fails, or UIKit logs *BUG IN CLIENT
OF UIKIT*). Apple DTS, answering this exact question for a Share Extension:

> "App extensions are not allowed to open URLs directly. This isn't accidental,
> but a deliberate design choice on Apple's part. Don't try to bypass such
> restrictions using Silly Runtime Hacks™."

`extensionContext.open(_:)` is not a way around it either — it is documented for
Today widgets, and reports are that it returns `success = false` from a Share
Extension.

Observed symptom before the fix: sharing a Safari page appeared to do nothing at
all, and the pre-filled Add sheet was discovered later, on the next manual app
launch. The payload path was working the whole time; the silence was the bug,
because a UI-less extension gives no other signal.

**What replaced it:** a confirmation sheet ("Saved to lifeGLANCE" + the captured
title + Done). Apple's own suggested alternative is a local notification the user
taps to open the app; that was declined deliberately, because lifeGLANCE ships
with no notification code or permission anywhere, and introducing its first
permission prompt for share convenience is a poor trade in a no-account,
local-first app. Revisit only if notifications arrive for another reason.

Do not re-add an auto-open attempt. `AppDelegate.handleWidgetDeepLink` has no
`share` case for the same reason.

### 4. `WidgetStore` additions (`WidgetModel.swift`)

Add a third pending key alongside the existing target/action ones. It holds a
**queue** (array of JSON strings), not a single value:

```swift
static let keyPendingShare = "pending_share"   // [String] of JSON { text, subject }

// Pops the oldest entry, leaving the rest queued. Returns a single JSON string,
// so the JS contract is unchanged: one share per consumeLaunchTarget(), matching
// the one Add-milestone sheet the app can show.
static func consumePendingShare() -> String? { … }
```

There is deliberately **no writer here** — the extension appends to the App Group
inline (`ShareViewController.enqueue`) so it stays a single self-contained file,
as §1 explains. This side only reads.

**Why a queue and not one slot.** With auto-open, every share immediately
foregrounded the app and drained the slot, so last-write-wins was safe. Without
it, shares pile up until the user next opens lifeGLANCE — so sharing two things
before opening the app silently discarded the first. Android keeps a single slot
and is *not* affected, because its `ACTION_SEND` path really does open the app
each time.

Both readers tolerate a legacy single-string value written before the queue
existed, so an app updating in place does not drop a share captured by the old
build.

### 5. `WidgetBridgePlugin.consumeLaunchTarget` (App target)

Return the pending share so the JS bridge sees it — one added block, mirroring the
Android `ret.put("share", …)`:

```swift
if let share = WidgetStore.consumePendingShare() {
    result["share"] = share
}
```

### 6. `AppDelegate` — nothing to do

Originally this section added a `case "share": break` so the deep link was
visibly handled. That case has been **removed**: `lifeglance://share` is never
fired, because the extension cannot open the app (§3a). A comment in
`handleWidgetDeepLink` records why, so the absence reads as deliberate.

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
- **Nothing usable:** queue nothing, so the app doesn't open a blank draft, and
  tell the user so ("Nothing to save") rather than dismissing silently.
- **Several shares before the app is opened:** all are kept, oldest first, and
  surface one per `consumeLaunchTarget()`. Note the app only drains one per
  launch/resume today — see *Known gap* below.
- **Images / files:** out of scope; the activation rule restricts to text/URL/page,
  so non-text attachments never reach us.
- **App Group sandbox:** the extension must use `UserDefaults(suiteName:)`, never
  `.standard`. `WidgetStore` already does this.

## Acceptance tests (manual — no iOS device CI)

`.github/workflows/ios.yml` compiles the extension, which catches project and
Swift errors, but it never runs the app — so nothing below is covered by CI.

Tests 0–3 passed on device (Safari page share, before the confirmation UI landed).
Note the expected result is **no longer** "the app opens" — it is "the extension
confirms, and the draft is waiting on next launch":

0. lifeGLANCE appears in the share sheet at all. An activation-rule or
   principal-class error presents as a silently missing entry, not a crash.
1. Share plain text from Notes → "Saved to lifeGLANCE" → open app → Add sheet
   titled from the text.
2. Share a URL from Safari → open app → Add sheet with URL and hostname/title.
3. Share with an explicit subject/title → subject becomes the title.

Still outstanding, all new with the confirmation UI and queue:

4. Share something empty/unusable → "Nothing to save", and no blank draft on
   next launch.
5. The confirmation sheet renders correctly in light and dark, and Done dismisses.
6. **Queue:** share three items without opening the app in between, then open the
   app three times (backgrounding between) → all three drafts appear, oldest
   first, none lost.
7. Upgrade path: a share captured by the pre-queue build still surfaces after
   updating to this one.

## Known gap

The app drains **one** queued share per launch/resume, because
`consumeLaunchTarget()` is called from `TimelineView`'s `visibilitychange`
handler and the app can only show one Add sheet at a time. Sharing three things
then opening the app once yields the first draft; the other two wait for the next
resume. Nothing is lost, but draining the rest as each sheet is dismissed would
be the better behaviour — a small `TimelineView` change, deliberately not bundled
with the native fix.

## Out of scope

- Rich-media (image/file) shares.
- A compose/edit UI in the extension. The confirmation sheet added in §3a is
  deliberately read-only — it reports what was captured, it does not let the user
  edit the milestone before saving.
- Opening the host app from the extension, by any means, including a local
  notification the user taps (§3a).
- Deriving the extension's `MARKETING_VERSION` from `package.json` (tracked
  separately with the App target — see the version-drift note in the iOS cleanup).
