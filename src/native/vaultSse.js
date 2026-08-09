import { Capacitor, registerPlugin } from '@capacitor/core'

// Native GLANCEvault SSE reader (the Android and iOS shells implement the same
// plugin surface, ported from lastGLANCE's; neither lifeGLANCE shell carries it
// yet — PR 2/3 of the SSE rollout). The WebView cannot stream /events (vault
// HTTP rides the buffered CapacitorHttp path), so the SHELL owns the socket —
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
