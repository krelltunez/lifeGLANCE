import UIKit
import Capacitor

// Registration here is the ONLY thing that makes an app-target plugin exist to
// the web layer. A plugin missing from this list still compiles, still passes
// CI, and Capacitor.isPluginAvailable() simply answers false — which JS bridges
// treat as "feature not present" and silently no-op. That is how Spotlight
// indexing shipped dead the first time: the class was written, compiled, and
// never registered.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        bridge?.registerPluginInstance(VaultSsePlugin())
        bridge?.registerPluginInstance(SpotlightPlugin())
    }
}
