# LifeGlanceShare — iOS Share Extension

Native half of the "share text/link into lifeGLANCE" feature (parity with the
Android `ACTION_SEND` share target). Implements the spec in
`docs/ios-share-extension-spec.md`.

The source is complete and lives here:

| File | Purpose |
| ---- | ------- |
| `ShareViewController.swift` | Reads shared text/URL, writes `pending_share` to the App Group, opens the host app. No UI. |
| `Info.plist` | `NSExtension` config + activation rule (text / web URL / web page). |
| `LifeGlanceShare.entitlements` | App Group `group.com.lifeglance`. |

The app-side hooks are already wired on this branch:
`WidgetStore.consumePendingShare()` (`WidgetModel.swift`), the `share` field in
`WidgetBridgePlugin.consumeLaunchTarget`, and the `share` host in
`AppDelegate.handleWidgetDeepLink`. The web layer already consumes it
(`TimelineView` → `shareToMilestoneDraft`), so **no JS changes are needed**.

## One remaining step: register the target in Xcode

The Xcode project uses the modern synchronized-folder format (`objectVersion 70`),
and the target graph (native target, embed-extension build phase, signing) is best
created through Xcode so provisioning is set up correctly. It is intentionally not
hand-edited into `project.pbxproj`. To finish:

1. Open `ios/App/App.xcodeproj`.
2. **File ▸ New ▸ Target… ▸ Share Extension.**
   - Product name: **LifeGlanceShare**
   - Bundle identifier: **com.lifeglance.share**
   - Language: Swift, and **embed in the App target** when prompted.
3. Xcode generates a `ShareViewController.swift`, an `Info.plist`, and a
   `MainInterface.storyboard`. **Replace/point them at the files in this folder**
   and **delete the generated `MainInterface.storyboard`** (this extension has no
   UI — activation uses `NSExtensionPrincipalClass`, not a storyboard).
4. In the target's **Build Settings**:
   - `INFOPLIST_FILE` = `LifeGlanceShare/Info.plist`
   - `GENERATE_INFOPLIST_FILE` = `YES`
   - `CODE_SIGN_ENTITLEMENTS` = `LifeGlanceShare/LifeGlanceShare.entitlements`
   - `IPHONEOS_DEPLOYMENT_TARGET` = `15.0` (match App)
   - `MARKETING_VERSION` = `2.6.2`, `CURRENT_PROJECT_VERSION` = `1` (match App)
5. **Signing & Capabilities ▸ + Capability ▸ App Groups**, and check
   `group.com.lifeglance` (must match the entitlements file above).
6. Confirm the **App** target's *Embed Foundation Extensions* build phase lists
   `LifeGlanceShare.appex` (Xcode adds this when you choose "embed in App").

Then `npx cap sync ios` and build. The iOS CI workflow will start covering the
extension automatically once the target exists.

## Manual test

1. Share plain text from Notes → lifeGLANCE opens with the Add sheet titled from the text.
2. Share a link from Safari → Add sheet with the URL populated and hostname/title.
3. Share with an explicit subject/title → subject becomes the title.
4. Share something empty/unusable → app does not open a blank draft.
