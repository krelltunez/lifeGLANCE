package com.lifeglance.app.sse

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/**
 * Capacitor face of the native GLANCEvault SSE reader ([VaultSseClient]).
 *
 * The renderer (src/hooks/useVaultEventStream.js, 'native-bridge' transport)
 * declares intent with start/stop and receives every reader message as an
 * `sseMessage` plugin event — the same `{type, block?/message?/code?}` shapes
 * dayGLANCE's shells push, so the renderer-side bridge client is shared code:
 *   {type:'open'}                    a (re)connection was established
 *   {type:'frame', block:'…'}        one raw SSE event block → parseSseFrame
 *   {type:'closed'}                  the stream dropped (native will reconnect)
 *   {type:'error', message, code?}   a coded error is TERMINAL (native stopped)
 *
 * The plugin owns only the wiring: lifecycle (foreground/background via the
 * Capacitor activity callbacks) and delivery (notifyListeners, any-thread
 * safe). The socket, reconnect, and terminal policy live in [VaultSseClient].
 * Capability detection needs no method here — the renderer probes
 * Capacitor.isPluginAvailable('VaultSse'), which an older shell without this
 * plugin answers false, degrading cleanly to polling.
 */
@CapacitorPlugin(name = "VaultSse")
class VaultSsePlugin : Plugin() {

    private var client: VaultSseClient? = null

    override fun load() {
        client = VaultSseClient { msg ->
            try {
                notifyListeners("sseMessage", JSObject.fromJSONObject(JSONObject(msg)))
            } catch (_: Exception) {
                // A malformed reader message must never break the bridge.
            }
        }
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val url = call.getString("vaultUrl")
        val token = call.getString("vaultToken")
        val account = call.getString("accountId")
        if (url.isNullOrEmpty() || token.isNullOrEmpty() || account.isNullOrEmpty()) {
            call.reject("vaultUrl, vaultToken, and accountId are required")
            return
        }
        client?.enable(url, token, account)
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        client?.disable()
        call.resolve()
    }

    // Foreground/background gating mirrors dayGLANCE's Activity wiring: the
    // reader connects only while the Activity is started, drops on stop (the OS
    // would kill the socket anyway), and the vault's `ready` frame reconciles on
    // every reconnect.
    override fun handleOnStart() {
        client?.setForeground(true)
    }

    override fun handleOnStop() {
        client?.setForeground(false)
    }

    override fun handleOnDestroy() {
        client?.shutdown()
        client = null
    }
}
