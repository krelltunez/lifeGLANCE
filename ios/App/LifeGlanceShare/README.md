# LifeGlanceShare — iOS Share Extension

Native half of the "share text/link into lifeGLANCE" feature (parity with the
Android `ACTION_SEND` share target). Implements the spec in
`docs/ios-share-extension-spec.md`.

| File | Purpose |
| ---- | ------- |
| `ShareViewController.swift` | Reads shared text/URL, appends it to the `pending_share` queue in the App Group, and shows a confirmation sheet. |
| `Info.plist` | `NSExtension` config + activation rule (text / web URL / web page). |
| `LifeGlanceShare.entitlements` | App Group `group.com.lifeglance`. |

**This extension does not open lifeGLANCE, and cannot.** iOS bars app extensions
from opening URLs; the responder-chain `openURL:` trick this was originally built
on stopped working in iOS 18 and is explicitly disavowed by Apple. A share
therefore lands quietly in the App Group and surfaces the next time the user opens
the app — the confirmation sheet exists so that reads as success rather than as
nothing having happened. Full reasoning in `docs/ios-share-extension-spec.md` §3a;
please read it before attempting to restore an auto-open.

The app-side hooks are wired: `WidgetStore.consumePendingShare()`
(`WidgetModel.swift`), the `share` field in
`WidgetBridgePlugin.consumeLaunchTarget`, and the `share` host in
`AppDelegate.handleWidgetDeepLink`. The web layer already consumes it
(`TimelineView` → `shareToMilestoneDraft`), so **no JS changes are needed**.

## Target registration

The `LifeGlanceShare` target is registered in `App.xcodeproj/project.pbxproj`.
It was added by hand rather than through Xcode's *New Target* assistant, so a
few things are worth knowing before editing it:

- The project is `objectVersion = 70`, so the target uses a
  **`PBXFileSystemSynchronizedRootGroup`** pointing at this folder. Files added
  here join the target automatically — there are no per-file build entries to
  maintain.
- `Info.plist`, `LifeGlanceShare.entitlements` and `README.md` are listed as
  `membershipExceptions` so they are not copied into the `.appex` as stray
  resources. Add any future non-code file to that exception set too.
- Signing is `Automatic` with `DEVELOPMENT_TEAM = CTZ7352A3G`, matching the App
  and widgets targets. There is no checked-in provisioning profile.
- `MARKETING_VERSION` is pinned to `3.0.0` alongside the App and widgets
  targets. It does **not** derive from `package.json` — see the version-drift
  note in `docs/ios-share-extension-spec.md`.

`NSExtensionPrincipalClass` is the bare string `ShareViewController`, not
`$(PRODUCT_MODULE_NAME).ShareViewController`. `ShareViewController` is declared
`@objc(ShareViewController)`, which overrides its Objective-C runtime name to
drop the module prefix; since the system resolves this key with
`NSClassFromString`, the module-qualified form would not resolve and the
extension would fail to launch. If the `@objc` attribute is ever removed, this
key must change back in the same commit.

## Manual test

CI (`.github/workflows/ios.yml`) compiles the extension but cannot exercise it —
there is no device or simulator run. These four are device-only:

1. Share plain text from Notes → "Saved to lifeGLANCE" → open the app → Add sheet titled from the text.
2. Share a link from Safari → open the app → Add sheet with the URL populated and hostname/title.
3. Share with an explicit subject/title → subject becomes the title.
4. Share something empty/unusable → "Nothing to save", and no blank draft later.
5. Share three items without opening the app in between → all three drafts appear
   across subsequent resumes, oldest first, none lost.

Check specifically that lifeGLANCE **appears in the share sheet at all** — an
activation-rule or principal-class mistake shows up as a silently missing entry,
not as a crash.
