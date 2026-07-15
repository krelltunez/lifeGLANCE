// Billing wiring for the Play-distributed build.
//
// Gating is structural, not a flag to strip: only the Play channel on Android
// constructs a billing adapter. Every other distribution — web/PWA, the GitHub
// sideload APK, dev builds — passes `adapter: null` and the engine reports the
// install as ungated ('channel' entitlement). Prices and trial length live in
// Play Console, never here.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { playManageSubscriptionUrl } from '@glance-apps/billing'
import { createCapacitorAdapter } from '@glance-apps/billing/capacitor'
import { useBilling } from '@glance-apps/billing/react'
import { REVIEWER_SECRET } from '../config/reviewerAccess'

// Must match the product ids configured in Play Console exactly.
export const PRODUCT_IDS = {
  yearly: 'lifeglance_pro_annual',
  lifetime: 'lifeglance_pro_lifetime',
}

const CHANNEL = import.meta.env.VITE_BUILD_CHANNEL ?? 'web'
const isGatedChannel = CHANNEL === 'play' && Capacitor.getPlatform() === 'android'

const BillingBridge = registerPlugin('BillingBridge')
const adapter = isGatedChannel
  ? createCapacitorAdapter({ plugin: BillingBridge, products: PRODUCT_IDS })
  : null

export const MANAGE_SUBSCRIPTION_URL =
  playManageSubscriptionUrl('com.lifeglance.app', PRODUCT_IDS.yearly)

// Platform-derived store name for payment/cancel copy ("Payment via {store}.").
// Names the right store today and survives the iOS adapter with no copy change.
export const STORE_NAME = Capacitor.getPlatform() === 'ios' ? 'App Store' : 'Google Play'

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
