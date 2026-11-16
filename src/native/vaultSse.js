import { Capacitor, registerPlugin } from '@capacitor/core'
import { desktopBridge } from './desktop.js'

// Native GLANCEvault SSE reader (the Android and iOS shells implement the same
// plugin surface, ported from lastGLANCE's). BOTH shells now register it:
// Android in MainActivity.onCreate (registerPlugin(VaultSsePlugin.class)), iOS
// in MainViewController.capacitorDidLoad (registerPluginInstance), so a current
// build detects 'native-bridge' rather than 'native-unsupported'. The capability
// probe below is still the only thing that decides at runtime — an older
// installed APK/IPA predating the readers answers false and keeps polling.
// The WebView cannot stream /events (vault HTTP rides the buffered
// CapacitorHttp path), so the SHELL owns the socket —
// connecting while foreground, dropping on background, reconnecting with
// backoff — and pushes every reader message in as an `sseMessage` plugin event.
// The renderer's bridge client (createBridgeSseClient in
// src/sync/vaultEventStream.js) funnels frames through the SAME parseSseFrame
// → coalescer → drains as the web transport.
//
// Message shapes (identical across the GLANCE app family, so the renderer
// logic is shared code):
//   {type:'open'}                    a native (re)connection was established
//   {type:'frame', block:'…'}        one raw SSE event block
//   {type:'closed'}                  the stream dropped (native will reconnect)
//   {type:'error', message, code?}   coded errors are TERMINAL — native stopped
//                                    and will NOT reconnect ('auth' = rejected
//                                    token, 'insecure' = refused cleartext URL,
//                                    'unsupported' = server predates /events)

export const VaultSse = registerPlugin('VaultSse')

// Strict capability probe: true only when a native shell actually registered
// the plugin. A shell predating the reader answers false and the app keeps its
// polling behavior — the same degrade-to-polling contract the sibling apps
// established.
export function isVaultSseNativeAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('VaultSse')
}

/**
 * The shell's reader as three calls, whichever shell it is: the Capacitor
 * plugin on the phones, or the desktop app's main process (electron/vaultSse.js),
 * which speaks the same messages. Null where no shell reads the stream (the web
 * reads it itself; an older phone shell polls).
 *
 * @returns {{ start: (options: object) => Promise<void>, stop: () => Promise<void>, listen: (listener: (message: object) => void) => () => void } | null}
 */
export function vaultSseBridge() {
  const desktop = desktopBridge()
  if (desktop) {
    return {
      start: (options) => Promise.resolve(desktop.vaultSse.start(options)),
      stop: () => Promise.resolve(desktop.vaultSse.stop()),
      listen: (listener) => desktop.vaultSse.onMessage(listener),
    }
  }
  if (!isVaultSseNativeAvailable()) return null
  return {
    start: (options) => VaultSse.start(options),
    stop: () => VaultSse.stop(),
    listen: (listener) => {
      // Capacitor hands the handle back asynchronously; an unsubscribe that
      // comes first removes it on arrival.
      let handle = null
      let removed = false
      Promise.resolve(VaultSse.addListener('sseMessage', listener))
        .then((h) => { if (removed) void h?.remove?.(); else handle = h })
        .catch(() => {})
      return () => { removed = true; void handle?.remove?.() }
    },
  }
}
