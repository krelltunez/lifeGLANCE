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
        paintLaunchBackground()
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        bridge?.registerPluginInstance(VaultSsePlugin())
        bridge?.registerPluginInstance(SpotlightPlugin())
        bridge?.registerPluginInstance(SecureStorePlugin())
        bridge?.registerPluginInstance(DirectAccessPlugin())
        bridge?.registerPluginInstance(ICloudPlugin())
        bridge?.registerPluginInstance(BillingBridgePlugin())
    }

    /// The web view IS this controller's view (Capacitor's loadView), and until
    /// the page paints its first frame the web view's own background is what
    /// shows. Capacitor makes that `systemBackground` when capacitor.config sets
    /// no colour: white in light mode, a white flash between the dark launch
    /// screen and the app. Paint it the launch screen's colour instead, so the
    /// launch screen simply continues until the page appears.
    ///
    /// LaunchBackground has a light and a dark appearance, matching the two
    /// Splash images, which a single capacitor.config colour cannot. Called from
    /// capacitorDidLoad: after the web view exists, before the page loads.
    /// The same function as lastGLANCE's BridgeViewController.
    private func paintLaunchBackground() {
        guard let launch = UIColor(named: "LaunchBackground") else { return }
        view.backgroundColor = launch
        webView?.isOpaque = false
        webView?.backgroundColor = launch
        webView?.scrollView.backgroundColor = launch
    }
}
