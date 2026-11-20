import Foundation
import Capacitor

// iOS face of the BillingBridge Capacitor plugin. Same name and JS contract as
// the Android plugin shipped in @glance-apps/billing (BillingBridgePlugin.kt),
// so src/billing/billing.js's one createCapacitorAdapter drives both stores
// with no iOS-specific JS. The store logic is RevenueCatBilling. Ported from
// lastGLANCE; keep the two in sync when fixing either.
//
//   initialize({ yearlyProductId, lifetimeProductId }) → { refreshReportsCompletion: true }
//   getStatus()            → { active, productId }   productId null when none
//   refresh()              → void, once the re-read (and, when inactive, the
//                            sync: the restore) has FINISHED; an overlapping
//                            call resolves when the one in flight does
//   purchase({ productId }) → void; the outcome arrives as a billingEvent
//   getProductPrices()     → { yearly, lifetime, yearlyTrialDays }   each null until known
//   getTrialEligibility()  → { "<yearlyProductId>": boolean }
//   event "billingEvent"   { status, code, message, productId }; status
//                          'pending' with code 100 (deferred) or 101 (completed,
//                          entitlement missing) is neither success nor failure
//   event "billingStatus"  { active: true, productId }: an entitlement
//                          RevenueCat reported on its own. ACTIVE ONLY.
//
// The refreshReportsCompletion and billingStatus halves are
// @glance-apps/billing 0.2.4's opt-in contract (createCapacitorAdapter).
//
// consumeTestPurchase is Play-only (consuming a test lifetime token) and is not
// implemented here; Capacitor rejects a call to it as unimplemented.
//
// Registered in MainViewController.capacitorDidLoad(). An unregistered plugin
// still compiles and passes CI and simply does not exist to the web layer;
// src/billing/billingIosParity.test.js fails if the registration goes missing.
@objc(BillingBridgePlugin)
public class BillingBridgePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "BillingBridgePlugin"
    public let jsName = "BillingBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        "initialize", "getStatus", "refresh", "purchase", "getProductPrices", "getTrialEligibility",
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    private let billing = RevenueCatBilling.shared

    override public func load() {
        billing.onBillingEvent = { [weak self] status, code, message, productId in
            self?.notifyListeners("billingEvent", data: [
                "status": status,
                "code": code,
                "message": message,
                "productId": productId,
            ])
        }
        billing.onActiveEntitlement = { [weak self] productId in
            self?.pushActiveEntitlement(productId)
        }
    }

    /// The 'billingStatus' push. `active` is the literal true: this is the only
    /// place the event is sent, and it has no inactive form.
    private func pushActiveEntitlement(_ productId: String?) {
        #if DEBUG
        // Under -GlanceBillingStartLocked a push could unlock the app before a
        // person did anything (RevenueCat reports the cached entitlement on its
        // first fetch), and the locked-restore test would pass proving nothing.
        // So pushes wait for the first status read a person caused; see the
        // section on the overrides below.
        if startLocked, !startLockedPersonRead { return }
        #endif
        notifyListeners("billingStatus", data: [
            "active": true,
            "productId": productId.map { $0 as Any } ?? NSNull(),
        ])
    }

    @objc func initialize(_ call: CAPPluginCall) {
        guard let yearly = call.getString("yearlyProductId"), !yearly.isEmpty,
              let lifetime = call.getString("lifetimeProductId"), !lifetime.isEmpty else {
            call.reject("yearlyProductId and lifetimeProductId are required")
            return
        }
        billing.setProductIds(yearly: yearly, lifetime: lifetime)
        // refresh() below resolves only once its work is done; saying so is
        // what makes the adapter read then instead of after a fixed delay.
        call.resolve(["refreshReportsCompletion": true])
    }

    // Debug builds (Xcode Debug configuration) always read as Pro: no paywall
    // during local development. Release and TestFlight builds do not define
    // DEBUG (SWIFT_ACTIVE_COMPILATION_CONDITIONS), so everything in this
    // section is compiled out of them.
    //
    // Both overrides are LAUNCH ARGUMENTS, set in Xcode under Edit Scheme >
    // Run > Arguments > Arguments Passed On Launch. A `-key value` pair lands
    // in UserDefaults' argument domain for that launch only, and the read
    // counter below lives in memory, so nothing either override does outlives
    // the process: untick the argument, or launch from the home screen, and
    // the default behaviour is back with nothing written to disk.
    //
    //   -GlanceBillingRealStatus YES
    //       Report the real entitlement from the first read onward, so a Debug
    //       build gates exactly as a store build does.
    //
    //   -GlanceBillingStartLocked YES
    //       Report inactive for the mount reads, then the real entitlement
    //       from the next read onward. The app opens at the paywall and
    //       NOTHING ELSE IS FAKED: refresh(), purchase(), getProductPrices()
    //       and getTrialEligibility() are untouched and talk to RevenueCat as
    //       usual, so a Restore tap runs the real refresh path, finds the
    //       entitlement and unlocks the app. That unlock is the test passing.
    //
    //       It exists because the locked-install restore path is otherwise
    //       untestable on a device that already owns the subscription:
    //       deleting and reinstalling re-unlocks from the Apple ID, and a
    //       sandbox subscription will not lapse for about a week. The same
    //       block is what makes the paywall reachable for a screenshot of it,
    //       which App Store Connect asks for alongside the subscription.
    //
    //       It also holds back the 'billingStatus' push (RevenueCat's
    //       delegate) until the first real read, the first one a person can
    //       have caused. Without that, RevenueCat reporting the device's
    //       entitlement on its first fetch would unlock the app with no
    //       Restore tap, and the test would pass proving nothing. The push is
    //       held, not faked: once a person has acted it flows as usual.
    //
    // WHY A READ COUNT AND NOT A TIMER. The adapter's mount sequence is
    // exactly two status reads — one immediately, one re-read at
    // mountRereadMs — and no further read happens without a user action (a
    // Restore tap, or the app regaining visibility). Suppressing a fixed two
    // reads is therefore independent of both timing and ordering: it cannot
    // swallow the read that follows a Restore tap, however fast the tap
    // arrives, which any window measured in seconds eventually would. Should
    // the adapter ever change its mount sequence, this fails OPEN — the app
    // unlocks by itself, visibly, in a Debug build.

    #if DEBUG
    /// Whether `-GlanceBillingStartLocked` is in force. The one place the
    /// override is read.
    private var startLocked: Bool { UserDefaults.standard.bool(forKey: "GlanceBillingStartLocked") }

    /// Status reads already served while `-GlanceBillingStartLocked` is in
    /// force. In memory for the life of the process by design.
    private var startLockedReads = 0

    /// The two mount reads. Both are the initial read; the third read is the
    /// first one a person can have caused.
    private static let startLockedSuppressedReads = 2

    /// Set by that third read. Until then 'billingStatus' pushes are held
    /// (pushActiveEntitlement). In memory, like the counter.
    private var startLockedPersonRead = false
    #endif

    @objc func getStatus(_ call: CAPPluginCall) {
        #if DEBUG
        let startLocked = self.startLocked
        if startLocked, startLockedReads < Self.startLockedSuppressedReads {
            startLockedReads += 1
            call.resolve(["active": false, "productId": NSNull()])
        } else if startLocked || UserDefaults.standard.bool(forKey: "GlanceBillingRealStatus") {
            if startLocked { startLockedPersonRead = true }
            let status = billing.status()
            call.resolve([
                "active": status.active,
                "productId": status.productId.map { $0 as Any } ?? NSNull(),
            ])
        } else {
            call.resolve(["active": true, "productId": NSNull()])
        }
        #else
        let status = billing.status()
        call.resolve([
            "active": status.active,
            "productId": status.productId.map { $0 as Any } ?? NSNull(),
        ])
        #endif
    }

    @objc func refresh(_ call: CAPPluginCall) {
        // Resolves when the work is done (initialize() says so to the adapter).
        Task {
            await billing.refresh()
            call.resolve()
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            call.reject("productId is required")
            return
        }
        billing.purchase(productId: productId)
        call.resolve()
    }

    @objc func getProductPrices(_ call: CAPPluginCall) {
        let prices = billing.prices()
        call.resolve([
            "yearly": prices.yearly.map { $0 as Any } ?? NSNull(),
            "lifetime": prices.lifetime.map { $0 as Any } ?? NSNull(),
            "yearlyTrialDays": prices.yearlyTrialDays.map { $0 as Any } ?? NSNull(),
        ])
    }

    @objc func getTrialEligibility(_ call: CAPPluginCall) {
        call.resolve([billing.productIds.yearly: billing.trialEligible()])
    }
}
