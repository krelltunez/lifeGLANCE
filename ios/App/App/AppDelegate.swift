import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // A widget tap opens lifeglance://milestone?id=<id>. Stash the id where the web
        // layer reads it via WidgetBridge.consumeLaunchTarget() once it resumes. Kept
        // self-contained (no shared-file dependency) so this compiles on its own.
        handleWidgetDeepLink(url)
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    private func handleWidgetDeepLink(_ url: URL) {
        guard url.scheme == "lifeglance" else { return }
        let defaults = UserDefaults(suiteName: "group.com.lifeglance")
        switch url.host {
        case "milestone":
            if let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
               let id = comps.queryItems?.first(where: { $0.name == "id" })?.value {
                defaults?.set(id, forKey: "pending_target")
            }
        case "new":
            defaults?.set("new", forKey: "pending_action")
        case "share":
            // The Share Extension already wrote "pending_share" to the App Group
            // before opening this URL; nothing to stash here. Opening the app is
            // enough — the web layer reads the share via consumeLaunchTarget() on
            // resume. Handled explicitly so it doesn't fall through to default.
            break
        default:
            break
        }
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
