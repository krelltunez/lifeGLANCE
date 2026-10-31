import Foundation
import RevenueCat

// RevenueCat (StoreKit 2) billing behind BillingBridgePlugin: the iOS
// counterpart of @glance-apps/billing's PlayBillingCore, which the same plugin
// contract drives on Play. Ported from dayGLANCE's SubscriptionBridge.swift;
// the RevenueCat logic is its logic, only the transport differs (promises and
// a 'billingEvent' listener instead of synchronous strings and
// evaluateJavaScript). The plugin owns the wiring; this owns the store. The
// same file ships in lastGLANCE; keep the two in sync when fixing either.
//
// A singleton because Purchases is configured in AppDelegate, before the
// bridge (and so the plugin instance) exists.
//
// Product ids default to the ones src/billing/billing.js passes and are
// replaced by the plugin's initialize(), so the web layer stays the single
// source of truth. Prices, trial length and eligibility are cached per product
// id, so a change of ids never serves another product's cached values.
final class RevenueCatBilling {

    static let shared = RevenueCatBilling()

    static let entitlementId = "pro"

    /// Terminal purchase outcomes, `{status, code, message, productId}`. Set by
    /// BillingBridgePlugin.load(); called from any thread.
    var onBillingEvent: ((_ status: String, _ code: Int, _ message: String, _ productId: String) -> Void)?

    private let lock = NSLock()
    private var yearlyId = "lifeglance_pro_annual"
    private var lifetimeId = "lifeglance_pro_lifetime"
    private var syncInFlight = false

    private init() {}

    // MARK: - Configuration

    func configure(apiKey: String) {
        Purchases.logLevel = .warn
        Purchases.configure(withAPIKey: apiKey)
        Task { _ = try? await Purchases.shared.customerInfo() }
        fetchPrices()
        checkTrialEligibility()
    }

    var productIds: (yearly: String, lifetime: String) {
        lock.lock(); defer { lock.unlock() }
        return (yearlyId, lifetimeId)
    }

    func setProductIds(yearly: String, lifetime: String) {
        lock.lock()
        yearlyId = yearly
        lifetimeId = lifetime
        lock.unlock()
        guard Purchases.isConfigured else { return }
        fetchPrices()
        checkTrialEligibility()
    }

    // MARK: - Cached reads

    /// The entitlement from RevenueCat's cached customer info.
    func status() -> (active: Bool, productId: String?) {
        guard Purchases.isConfigured else { return (false, nil) }
        let ent = Purchases.shared.cachedCustomerInfo?.entitlements[Self.entitlementId]
        return (ent?.isActive == true, ent?.productIdentifier)
    }

    /// Localized prices and the yearly free-trial length (nil until known).
    func prices() -> (yearly: String?, lifetime: String?, yearlyTrialDays: Int?) {
        let ids = productIds
        let defaults = UserDefaults.standard
        let days = defaults.integer(forKey: Self.trialDaysKey(ids.yearly))
        return (defaults.string(forKey: Self.priceKey(ids.yearly)),
                defaults.string(forKey: Self.priceKey(ids.lifetime)),
                days > 0 ? days : nil)
    }

    /// Defaults to true when not yet determined: better to show trial copy and
    /// let Apple validate than to hide it from eligible users.
    func trialEligible() -> Bool {
        UserDefaults.standard.object(forKey: Self.trialEligibleKey(productIds.yearly)) as? Bool ?? true
    }

    // MARK: - Refresh

    /// Re-reads the entitlement, and syncs the store's transactions when it
    /// reads inactive.
    ///
    /// This mirrors the Android plugin, where refresh() queries Play for what
    /// the signed-in account owns and that query IS the restore operation:
    /// the shared adapter's restore() is refresh() followed by a status read.
    /// syncPurchases() is the StoreKit equivalent. restorePurchases() is
    /// deliberately never called: refresh() also runs on every mount, and
    /// restorePurchases() can raise the App Store sign-in sheet.
    ///
    /// The sync is NOT gated on this install having been entitled before. The
    /// Restore button routes through here, and the case it exists for is a new
    /// device or a reinstall, where no local flag exists. The same sync also
    /// recovers an entitlement RevenueCat transferred to another of the user's
    /// installs (dayGLANCE's autoSyncRecover).
    ///
    /// Nothing restore-specific is emitted: the adapter synthesizes
    /// restore_complete / restore_complete_active itself after its settle, so
    /// an event from here would reach the engine twice.
    func refresh() {
        guard Purchases.isConfigured else { return }
        Task {
            let info = try? await Purchases.shared.customerInfo(fetchPolicy: .fetchCurrent)
            if info?.entitlements[Self.entitlementId]?.isActive == true { return }
            guard beginSync() else { return }
            defer { endSync() }
            _ = try? await Purchases.shared.syncPurchases()
        }
        fetchPrices()
        checkTrialEligibility()
    }

    /// One sync at a time: a mount refresh and a Restore tap can land together.
    private func beginSync() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if syncInFlight { return false }
        syncInFlight = true
        return true
    }

    private func endSync() {
        lock.lock(); syncInFlight = false; lock.unlock()
    }

    // MARK: - Purchase

    func purchase(productId: String) {
        guard Purchases.isConfigured else {
            emit(status: "error", code: 3, message: "Billing is not configured", productId: productId)
            return
        }
        Task {
            do {
                let result: PurchaseResultData
                // Prefer the configured Offering package (preserves intro-offer
                // metadata for the annual free trial), but fall back to the bare
                // StoreKit product so a product that exists in App Store Connect but
                // isn't attached to the current RevenueCat Offering — the usual case
                // for the lifetime non-consumable — still purchases instead of
                // dead-ending on "Product not found".
                if let offerings = try? await Purchases.shared.offerings(),
                   let package = offerings.current?.availablePackages.first(where: {
                       $0.storeProduct.productIdentifier == productId
                   }) {
                    result = try await Purchases.shared.purchase(package: package)
                } else {
                    let products = await Purchases.shared.products([productId])
                    guard let product = products.first else {
                        emit(status: "error", code: 1, message: "Product not found", productId: productId)
                        return
                    }
                    result = try await Purchases.shared.purchase(product: product)
                }
                if result.userCancelled {
                    emit(status: "cancelled", code: -1, message: "User cancelled", productId: productId)
                } else {
                    emit(status: "success", code: 0, message: "ok", productId: productId)
                }
            } catch {
                emitError(error, productId: productId)
            }
        }
    }

    /// Delivers a thrown purchase error in the shared billing-event code space
    /// (Play Billing response codes) that @glance-apps/billing's
    /// billingErrorMessage understands. RevenueCat's raw ErrorCode values collide
    /// with that vocabulary — e.g. productAlreadyPurchased is raw value 6, which
    /// the paywall would render as "Network error" — so translate instead of
    /// passing rawValue through.
    private func emitError(_ error: Error, productId: String) {
        guard let rcError = error as? RevenueCat.ErrorCode else {
            emit(status: "error", code: 0, message: error.localizedDescription, productId: productId)
            return
        }
        // A dismissed StoreKit sheet can surface as a thrown purchaseCancelledError
        // rather than result.userCancelled — not an error the user should see.
        if rcError == .purchaseCancelledError {
            emit(status: "cancelled", code: -1, message: "User cancelled", productId: productId)
            return
        }
        let code: Int
        switch rcError {
        case .purchaseNotAllowedError:
            code = 3 // "Billing is not available on this device."
        case .storeProblemError, .productNotAvailableForPurchaseError:
            code = 4 // "This subscription isn't available right now. Please try again later."
        case .networkError, .offlineConnectionError, .productRequestTimedOut:
            code = 6 // "Network error. Please check your connection and try again."
        case .productAlreadyPurchasedError, .receiptAlreadyInUseError:
            code = 7 // "You already own this item."
        default:
            code = 0 // "Something went wrong with the purchase. Please try again."
        }
        emit(status: "error", code: code, message: error.localizedDescription, productId: productId)
    }

    private func emit(status: String, code: Int, message: String, productId: String) {
        onBillingEvent?(status, code, message, productId)
    }

    // MARK: - Prices and trial

    private func fetchPrices() {
        let ids = productIds
        Task {
            // By explicit product id rather than only from the current Offering,
            // so the lifetime price still populates when the lifetime
            // non-consumable isn't attached to the Offering in RevenueCat.
            let products = await Purchases.shared.products([ids.yearly, ids.lifetime])
            let defaults = UserDefaults.standard
            for product in products {
                defaults.set(product.localizedPriceString, forKey: Self.priceKey(product.productIdentifier))
                // Trial LENGTH comes from the store's introductory offer so the
                // paywall never hardcodes a number. Only a freeTrial payment mode
                // counts — payUpFront/payAsYouGo intro discounts are paid offers.
                if product.productIdentifier == ids.yearly,
                   let intro = product.introductoryDiscount, intro.paymentMode == .freeTrial {
                    let days = Self.days(from: intro.subscriptionPeriod)
                    if days > 0 {
                        defaults.set(days, forKey: Self.trialDaysKey(ids.yearly))
                    }
                }
            }
        }
    }

    /// Converts a StoreKit subscription period to whole days (weeks ×7, months
    /// ×30, years ×365 — trials are day/week periods in practice).
    private static func days(from period: RevenueCat.SubscriptionPeriod) -> Int {
        switch period.unit {
        case .day:   return period.value
        case .week:  return period.value * 7
        case .month: return period.value * 30
        case .year:  return period.value * 365
        @unknown default: return 0
        }
    }

    private func checkTrialEligibility() {
        let yearly = productIds.yearly
        Purchases.shared.checkTrialOrIntroDiscountEligibility(productIdentifiers: [yearly]) { results in
            guard let status = results[yearly]?.status else { return }
            switch status {
            case .eligible:
                UserDefaults.standard.set(true, forKey: Self.trialEligibleKey(yearly))
            case .ineligible, .noIntroOfferExists:
                // No intro offer on the product means no trial to claim: the
                // paywall shows generic trial copy for an eligible user whose
                // trial length is unknown, so this must not stay at true.
                UserDefaults.standard.set(false, forKey: Self.trialEligibleKey(yearly))
            default:
                break // unknown — don't write, keep the default-true fallback in trialEligible()
            }
        }
    }

    private static func priceKey(_ productId: String) -> String { "glance-billing.price.\(productId)" }
    private static func trialDaysKey(_ productId: String) -> String { "glance-billing.trial-days.\(productId)" }
    private static func trialEligibleKey(_ productId: String) -> String { "glance-billing.trial-eligible.\(productId)" }
}
