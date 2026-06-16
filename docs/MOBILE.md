# Mobile apps (iOS & Android)

lifeGLANCE ships to iOS and Android via [Capacitor](https://capacitorjs.com/),
which wraps the existing React/Vite web build in a native shell. There is one
codebase: the same app powers the web/PWA version and both native apps.

## How it works

- `vite build` produces the static web app in `dist/`.
- `cap sync` copies `dist/` into the native projects (`android/`, `ios/`) and
  updates native plugins.
- The native apps load the bundled web assets from inside a WebView, so the app
  still runs fully offline and client-side (IndexedDB + localStorage). No backend.

The native project folders (`android/`, `ios/`) are committed. Build artifacts,
copied web assets, and dependency caches (`Pods`, `build/`, `DerivedData`) are
git-ignored via the per-platform `.gitignore` files Capacitor generates.

## Prerequisites

- **Both:** Node 20+, then `npm install`.
- **Android:** [Android Studio](https://developer.android.com/studio) (bundles
  the Android SDK + JDK).
- **iOS:** macOS with [Xcode](https://developer.apple.com/xcode/). iOS native
  dependencies use Swift Package Manager (no CocoaPods needed).

## Commands

```bash
npm run build:mobile   # vite build + cap sync (run after any web change)
npm run android        # build:mobile, then open the project in Android Studio
npm run ios            # build:mobile, then open the project in Xcode
```

From Android Studio / Xcode you can run on a simulator/emulator or a connected
device, and produce signed release builds for the stores.

## Configuration

- `capacitor.config.json` — app id (`app.lifeglance`), app name, and `webDir`.
- App icons / splash live in the native projects. The web icons in `public/`
  are the source of truth; regenerate native assets with
  [`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets) when the
  artwork changes.

## Store accounts (one-time, non-code)

- **Apple:** Apple Developer Program — $99/year. Required to run on a physical
  device and to publish to the App Store.
- **Google:** Google Play Developer — $25 one-time.

## Known follow-ups

- **Service worker:** the PWA service worker still registers inside the WebView.
  It is harmless (assets are already bundled natively) but can serve stale
  content across app updates. Consider disabling SW registration in the native
  build if update glitches appear.
- **iOS storage:** running as a native app avoids Safari's 7-day eviction of
  unused-origin data that affects the PWA.
