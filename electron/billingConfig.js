// Billing on the Mac App Store build (docs/desktop-app.md, "Billing"). Under
// Universal Purchase the Mac app shares the iOS app's App Store products and
// its RevenueCat App Store app, so these are the iOS values:
// billingConfig.test.js holds them equal to src/billing/billing.js
// (PRODUCT_IDS), ios/App/App/AppDelegate.swift (the public SDK key) and
// ios/App/App/RevenueCatBilling.swift (the entitlement).
//
// Only the MAS build registers billing (main.js, process.mas), and
// @glance-apps/billing/electron-main checks for the App Store receipt on its
// own: two independent signals that every other desktop build is free.

export const MAS_BILLING = Object.freeze({
  rcApiKey: 'appl_QqAOGMhzlQloaQEiUnqyzndgVAo',
  entitlementId: 'pro',
  products: Object.freeze({ yearly: 'lifeglance_pro_annual', lifetime: 'lifeglance_pro_lifetime' }),
})
