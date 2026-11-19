// Billing wiring for the store-distributed builds (Play on Android, the App
// Store on iOS and, for the desktop app, the Mac App Store).
//
// Gating is structural, not a flag to strip: only the store builds construct a
// billing adapter. Every other distribution — web/PWA, the GitHub sideload APK,
// the direct desktop builds, dev web builds — passes `adapter: null` and the
// engine reports the install as ungated ('channel' entitlement). Prices and
// trial length live in the stores, never here.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { appleManageSubscriptionUrl, createElectronRendererAdapter, playManageSubscriptionUrl } from '@glance-apps/billing'
import { createCapacitorAdapter } from '@glance-apps/billing/capacitor'
import { useBilling } from '@glance-apps/billing/react'
import { REVIEWER_SECRET } from '../config/reviewerAccess'
import { desktopBridge } from '../native/desktop'

// Must match the product ids configured in Play Console and App Store Connect
// exactly (the same ids on both stores).
export const PRODUCT_IDS = {
  yearly: 'lifeglance_pro_annual',
  lifetime: 'lifeglance_pro_lifetime',
}

const PLATFORM = Capacitor.getPlatform()

// The two platforms are keyed differently on purpose; do not "align" them.
// Android needs the CHANNEL check because GitHub releases and Obtainium are a
// real free sideload channel sharing the Play build's applicationId, so the
// platform alone cannot tell them apart; VITE_BUILD_CHANNEL is set per artifact
// by build.sh. iOS has no equivalent: every build of the iOS app ships through
// the App Store or TestFlight, so the platform alone is the right key, and
// `npm run build:ios` sets no channel at all (CHANNEL reads 'web' there, or
// whatever build.sh's last Android pass synced, since build:mobile syncs both
// platforms; neither matters on iOS). This fails closed by design: no script or
// build path can produce an ungated iOS app. Web and PWA builds, including one
// added to an iPhone's home screen, report 'web' (Capacitor reports 'ios' only
// when its native shell has registered the `bridge` message handler), so they
// are never gated.
// The one thing that would break the iOS premise is EU alternative
// distribution: if GLANCE ever ships the iOS app outside the App Store, that
// build needs a channel of its own.
const CHANNEL = import.meta.env.VITE_BUILD_CHANNEL ?? 'web'

// The desktop app (docs/desktop-app.md, "Billing") is gated on the Mac App
// Store build only, the one desktop build a store sells. Capacitor reads 'web'
// there, so the shell's own bridge is the key: its main process reports
// process.mas (info.isMAS), and @glance-apps/billing/electron-main
// independently answers "entitled" to any build without an App Store receipt.
// Two separate signals that Developer ID, Windows and Linux builds are free.
const DESKTOP = desktopBridge()
const DESKTOP_MAS = DESKTOP?.info.isMAS === true
// The App Store: the iOS app, or the Mac app under Universal Purchase (the
// same products, bought once for both).
const APP_STORE = PLATFORM === 'ios' || DESKTOP_MAS

const isGatedChannel = (CHANNEL === 'play' && PLATFORM === 'android') || PLATFORM === 'ios'

// Safe to register unconditionally: on ungated builds the proxy is simply never
// called because the adapter below is null.
const BillingBridge = registerPlugin('BillingBridge')

// The plugin as the adapter sees it. On iOS, only the methods the native plugin
// implements: Capacitor's plugin proxy answers `typeof` with 'function' for ANY
// name, so passing it whole would make the engine report canConsumeTestPurchase
// for a method that rejects as UNIMPLEMENTED (consuming a test purchase is a
// Play-only operation).
const billingPlugin = PLATFORM === 'ios'
  ? {
      initialize: (options) => BillingBridge.initialize(options),
      getStatus: () => BillingBridge.getStatus(),
      refresh: () => BillingBridge.refresh(),
      purchase: (options) => BillingBridge.purchase(options),
      getProductPrices: () => BillingBridge.getProductPrices(),
      getTrialEligibility: () => BillingBridge.getTrialEligibility(),
      addListener: (eventName, listener) => BillingBridge.addListener(eventName, listener),
    }
  : BillingBridge

// On the Mac App Store build the purchases are the main process's: StoreKit
// and the RevenueCat check live there, and the bridge's `billing` group is the
// IPC surface the adapter drives.
const adapter = DESKTOP_MAS
  ? createElectronRendererAdapter({ api: DESKTOP.billing })
  : isGatedChannel
    ? createCapacitorAdapter({ plugin: billingPlugin, products: PRODUCT_IDS })
    : null

/** Whether this build sells the app (a store build with an adapter). */
export const BILLING_GATED = adapter !== null

// Whether this build has home-screen widgets and the quick-add tile, which the
// paywall lists among what a purchase unlocks. The phones do; the Mac app has
// neither. A store's review reads that list against the app in front of it, so
// the paywall names only what this build ships (dayGLANCE's rule for its own).
export const HAS_HOME_SCREEN_WIDGETS = !DESKTOP_MAS

// The store's own subscription-management screen. Apple's has no per-app deep
// link; the account's subscription list is where the user cancels.
export const MANAGE_SUBSCRIPTION_URL = APP_STORE
  ? appleManageSubscriptionUrl()
  : playManageSubscriptionUrl('com.lifeglance.app', PRODUCT_IDS.yearly)

// Platform-derived store name for payment/cancel copy ("Payment via {store}.").
// Every store-specific paywall string takes it through {{store}}.
export const STORE_NAME = APP_STORE ? 'App Store' : 'Google Play'

// The one billing hook the app uses. `products` must be passed to the ENGINE
// too (not only the adapter above) — it is what classifies entitlementSource
// as 'lifetime' vs 'subscription'; without it a lifetime purchase reads as an
// annual subscription in settings.
export function useSubscription() {
  return useBilling(() => ({
    adapter,
    products: PRODUCT_IDS,
    reviewerSecret: REVIEWER_SECRET,
  }))
}
