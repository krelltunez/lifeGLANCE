import { Capacitor, registerPlugin } from '@capacitor/core'

// Native bridge to the home-screen widgets. Implemented natively on Android
// (WidgetBridgePlugin); a no-op on web and any platform without the plugin.
//
//   updateSnapshot({ json })   — persist the widget snapshot and refresh widgets
//   consumeLaunchTarget()      — read + clear a pending deep-link target { milestoneId }
const WidgetBridge = registerPlugin('WidgetBridge')

const isNative = () => Capacitor.isNativePlatform()

// Pushes a freshly built snapshot to native storage. Swallows errors: a widget
// update failing must never disrupt the app. Returns true if the push was attempted.
export async function pushWidgetSnapshot(snapshot) {
  if (!isNative()) return false
  try {
    await WidgetBridge.updateSnapshot({ json: JSON.stringify(snapshot) })
    return true
  } catch (err) {
    console.warn('[widgetBridge] updateSnapshot failed:', err)
    return false
  }
}

// Returns a pending deep-link target a widget tap left behind, or null. The native
// side clears it once read, so this is safe to call on every resume. A target is
// either an action (e.g. { action: 'new' } from the quick-add widget) or a milestone
// to focus ({ milestoneId }).
export async function consumeWidgetLaunchTarget() {
  if (!isNative()) return null
  try {
    const res = await WidgetBridge.consumeLaunchTarget()
    if (res?.action) return { action: res.action }
    if (res?.share) {
      try {
        return { share: JSON.parse(res.share) }
      } catch {
        return null
      }
    }
    if (res?.milestoneId) return { milestoneId: res.milestoneId }
    return null
  } catch (err) {
    console.warn('[widgetBridge] consumeLaunchTarget failed:', err)
    return null
  }
}
