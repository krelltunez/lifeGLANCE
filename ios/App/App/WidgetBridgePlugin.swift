import Foundation
import Capacitor
import WidgetKit

// iOS half of the WidgetBridge plugin (the Android side is WidgetBridgePlugin.java).
// The web app pushes a render-ready snapshot here; it is written to the App Group
// container that the widget extension reads, and the widgets are reloaded.
//
// Capacitor auto-discovers plugins conforming to CAPBridgedPlugin; jsName must match
// registerPlugin('WidgetBridge') in src/native/widgetBridge.js.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "updateSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeLaunchTarget", returnType: CAPPluginReturnPromise),
    ]

    // Persists the snapshot JSON and reloads all widget timelines immediately.
    @objc func updateSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("Missing 'json'")
            return
        }
        WidgetStore.saveSnapshot(json)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    // Returns and clears a pending deep-link target left by a widget tap.
    @objc func consumeLaunchTarget(_ call: CAPPluginCall) {
        var result = JSObject()
        if let target = WidgetStore.consumePendingTarget() {
            result["milestoneId"] = target
        }
        call.resolve(result)
    }
}
