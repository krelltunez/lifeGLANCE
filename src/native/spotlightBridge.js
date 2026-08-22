import { Capacitor, registerPlugin } from '@capacitor/core'

// Pushes the milestone search index to iOS Core Spotlight (SpotlightPlugin).
// No-op everywhere else: Android never registers a 'Spotlight' plugin, so the
// availability probe answers false there and on the web, and an older iOS shell
// without the plugin degrades the same way.
const Spotlight = registerPlugin('Spotlight')

// The push is called from the same debounced flush as the widget snapshot, which
// fires on every data change. Re-indexing is idempotent but not free (delete +
// reinsert of every item), so skip when nothing changed since the last push.
let lastPushed = null

// Takes a FACTORY rather than the items so the (visibility-filtered, formatted)
// payload is never built on platforms that would only throw it away.
export async function maybePushSpotlightIndex(buildItems) {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Spotlight')) return false
  try {
    const json = JSON.stringify(buildItems())
    if (json === lastPushed) return false
    await Spotlight.setIndex({ json })
    lastPushed = json
    return true
  } catch (err) {
    // Never let search indexing disrupt the app; retry happens naturally on the
    // next data change since lastPushed wasn't updated.
    console.warn('[spotlight] index push failed:', err)
    return false
  }
}
