import Foundation
import Capacitor

// iOS face of the BillingBridge Capacitor plugin. Same name and JS contract as
// the Android plugin shipped in @glance-apps/billing (BillingBridgePlugin.kt),
// so src/billing/billing.js's one createCapacitorAdapter drives both stores
// with no iOS-specific JS. The store logic is RevenueCatBilling. Ported from
// lastGLANCE; keep the two in sync when fixing either.
//
//   initialize({ yearlyProductId, lifetimeProductId }) → void
//   getStatus()            → { active, productId }   productId null when none
//   refresh()              → void; re-reads and, when inactive, syncs (the restore)
//   purchase({ productId }) → void; the outcome arrives as a billingEvent
//   getProductPrices()     → { yearly, lifetime, yearlyTrialDays }   each null until known
//   getTrialEligibility()  → { "<yearlyProductId>": boolean }
//   event "billingEvent"   { status, code, message, productId }
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
    }

    @objc func initialize(_ call: CAPPluginCall) {
        guard let yearly = call.getString("yearlyProductId"), !yearly.isEmpty,
              let lifetime = call.getString("lifetimeProductId"), !lifetime.isEmpty else {
            call.reject("yearlyProductId and lifetimeProductId are required")
            return
        }
        billing.setProductIds(yearly: yearly, lifetime: lifetime)
        call.resolve()
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        // Debug builds (Xcode Debug configuration) always read as Pro: no paywall
        // during local development. Release and TestFlight builds do not define
        // DEBUG (SWIFT_ACTIVE_COMPILATION_CONDITIONS), so this is compiled out.
        //
        // To see the real reading (and the paywall) in a Debug build, launch
        // with `-GlanceBillingRealStatus YES` (Xcode: Edit Scheme > Run >
        // Arguments Passed On Launch). A `-key value` launch argument lands in
        // UserDefaults' argument domain for that launch only, so removing or
        // unticking it restores the default.
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "GlanceBillingRealStatus") {
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
        billing.refresh()
        call.resolve()
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
