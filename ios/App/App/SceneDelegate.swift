import UIKit
import Capacitor
import CoreSpotlight

// The UIScene lifecycle. Apps built with the iOS 27 SDK must adopt it: one
// that does not is terminated at launch on iOS 27
// (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption). The scene
// is declared in Info.plist (UIApplicationSceneManifest), which also names
// Main.storyboard, so UIKit builds the window and MainViewController itself.
//
// Under scenes, URL opens and user activities reach the scene delegate, never
// AppDelegate's application(_:open:options:) or application(_:continue:...),
// and on a cold launch they arrive in connectionOptions instead of a later
// callback. Each path stashes the launch target first (the App Group contract
// WidgetBridgePlugin.consumeLaunchTarget() drains), then hands on to
// Capacitor's SceneDelegateProxy so plugins listening for URL opens still
// hear them.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // Cold launch from a widget tap or a Spotlight result: stash it now, so
        // the web layer finds it on its first consumeLaunchTarget().
        for context in connectionOptions.urlContexts { LaunchTarget.handle(url: context.url) }
        for activity in connectionOptions.userActivities { LaunchTarget.handle(activity: activity) }
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { LaunchTarget.handle(url: context.url) }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        LaunchTarget.handle(activity: userActivity)
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

// Where a widget tap or a Spotlight result asks the app to go, stashed in the
// App Group for the web layer to read via WidgetBridge.consumeLaunchTarget()
// on launch or resume. Literals rather than WidgetStore, so this file stays
// self-contained.
enum LaunchTarget {

    private static var defaults: UserDefaults? { UserDefaults(suiteName: "group.com.lifeglance") }

    /// A widget tap opens lifeglance://milestone?id=<id> or lifeglance://new.
    static func handle(url: URL) {
        guard url.scheme == "lifeglance" else { return }
        switch url.host {
        case "milestone":
            if let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
               let id = comps.queryItems?.first(where: { $0.name == "id" })?.value {
                defaults?.set(id, forKey: "pending_target")
            }
        case "new":
            defaults?.set("new", forKey: "pending_action")
        // There is deliberately no "share" case. The Share Extension does not open
        // the app: iOS bars app extensions from opening URLs, so lifeglance://share
        // is never fired. Shares are queued under "pending_share" in the App Group
        // and drained by WidgetBridgePlugin.consumeLaunchTarget() on the next launch
        // or resume. See docs/ios-share-extension-spec.md before re-adding it.
        default:
            break
        }
    }

    /// A tapped Spotlight result (indexed by SpotlightPlugin) arrives as this
    /// activity type with the milestone id as its unique identifier: the same
    /// pending_target a widget tap sets.
    static func handle(activity: NSUserActivity) {
        if activity.activityType == CSSearchableItemActionType,
           let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
            defaults?.set(id, forKey: "pending_target")
        }
    }
}
