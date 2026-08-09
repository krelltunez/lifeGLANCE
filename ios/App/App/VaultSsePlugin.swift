import Capacitor
import UIKit

/// Capacitor face of the native GLANCEvault SSE reader ([VaultSseClient]) — the
/// iOS sibling of android/.../sse/VaultSsePlugin.kt, same plugin surface.
///
/// The renderer (src/hooks/useVaultEventStream.js, 'native-bridge' transport)
/// declares intent with start/stop and receives every reader message as an
/// `sseMessage` plugin event — the same `{type, block?/message?/code?}` shapes
/// dayGLANCE's shells push, so the renderer-side bridge client is shared code:
///   {type:'open'}                    a (re)connection was established
///   {type:'frame', block:'…'}        one raw SSE event block → parseSseFrame
///   {type:'closed'}                  the stream dropped (native will reconnect)
///   {type:'error', message, code?}   a coded error is TERMINAL (native stopped)
///
/// The plugin owns only the wiring: lifecycle (foreground/background via
/// UIApplication notifications — the iOS analog of Android's activity
/// callbacks) and delivery (notifyListeners, any-thread safe). The socket,
/// reconnect, and terminal policy live in [VaultSseClient]. Capability
/// detection needs no method here — the renderer probes
/// Capacitor.isPluginAvailable('VaultSse'), which an older shell without this
/// plugin answers false, degrading cleanly to polling.
///
/// REGISTRATION: app-local plugins are not auto-discovered on iOS; this one is
/// registered in MainViewController.capacitorDidLoad().
@objc(VaultSsePlugin)
public class VaultSsePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VaultSsePlugin"
    public let jsName = "VaultSse"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private var client: VaultSseClient?

    override public func load() {
        client = VaultSseClient { [weak self] msg in
            var data = JSObject()
            for (key, value) in msg { data[key] = value }
            self?.notifyListeners("sseMessage", data: data)
        }
        // Foreground/background gating mirrors the Android plugin's
        // handleOnStart/handleOnStop: the reader connects only while the app is
        // foreground, drops on background (the OS would suspend the socket
        // anyway), and the vault's `ready` frame reconciles on every reconnect.
        // The client's foreground state defaults true, covering the initial
        // launch (willEnterForeground does not fire for it).
        NotificationCenter.default.addObserver(
            self, selector: #selector(appWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        client?.shutdown()
        client = nil
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let url = call.getString("vaultUrl"), !url.isEmpty,
              let token = call.getString("vaultToken"), !token.isEmpty,
              let account = call.getString("accountId"), !account.isEmpty else {
            call.reject("vaultUrl, vaultToken, and accountId are required")
            return
        }
        client?.enable(vaultUrl: url, token: token, accountId: account)
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        client?.disable()
        call.resolve()
    }

    @objc private func appWillEnterForeground() {
        client?.setForeground(true)
    }

    @objc private func appDidEnterBackground() {
        client?.setForeground(false)
    }
}
