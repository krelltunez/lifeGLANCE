// Capacitor config as JS (not JSON) so WebView debugging can be env-gated.
//
// NOTE: named exports, not `export default`. The Capacitor CLI loads this file
// with require(); under this package's `"type": "module"` that returns the ES
// module namespace, so top-level config keys must BE the named exports — a
// default export would end up nested under `.default` and be ignored.

// appId is only a scaffold default — it is what `npx cap add <platform>` would
// stamp into a NEWLY generated native project. The identifiers that actually
// ship are set in the native projects and must not be changed:
//   Android: applicationId "com.lifeglance.app"           (android/app/build.gradle)
//   iOS:     PRODUCT_BUNDLE_IDENTIFIER = com.lifeglance   (ios/App/App.xcodeproj)
// The two diverged historically. This file carries the ANDROID id because that
// is the published one: regenerating android/ from a different value would
// produce a package Play cannot update and that no existing install can be
// upgraded over. Regenerating ios/ from here would need the bundle id (and the
// widget/share extension ids) put back by hand.
export const appId = 'com.lifeglance.app'
export const appName = 'lifeGLANCE'
export const webDir = 'dist'
export const plugins = {
  CapacitorHttp: {
    enabled: true,
  },
}

// Play Billing only works on the Play-signed release build, whose WebView is
// not inspectable by default. `build.sh --webview-debug` sets this env var so
// entitlement state can be reset via chrome://inspect during billing tests.
// Default off — a debuggable WebView in production would expose sync
// credentials to anyone with a USB cable, so never promote a
// --webview-debug build.
export const android = {
  webContentsDebuggingEnabled: process.env.CAP_WEBVIEW_DEBUG === '1',
}
