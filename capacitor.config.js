// Capacitor config as JS (not JSON) so WebView debugging can be env-gated.
//
// NOTE: named exports, not `export default`. The Capacitor CLI loads this file
// with require(); under this package's `"type": "module"` that returns the ES
// module namespace, so top-level config keys must BE the named exports — a
// default export would end up nested under `.default` and be ignored.
export const appId = 'com.lifeglance'
export const appName = 'lifeGLANCE'
export const webDir = 'dist'
export const plugins = {
  CapacitorHttp: {
    enabled: true,
  },
}

// Play Billing only works on the Play-signed release build, whose WebView is
// not inspectable by default. `build.sh --webview-debug` sets this env var so
// entitlement state can be reset via chrome://inspect during billing tests
// (see docs/paywall-billing-plan.md, Lessons 7/8). Default off — a debuggable
// WebView in production would expose sync credentials to anyone with a USB
// cable, so never promote a --webview-debug build.
export const android = {
  webContentsDebuggingEnabled: process.env.CAP_WEBVIEW_DEBUG === '1',
}
