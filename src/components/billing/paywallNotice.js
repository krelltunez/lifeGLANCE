import { BILLING_CODE_PENDING } from '@glance-apps/billing'

// Localized messages for the billing error codes the package maps; anything
// else falls through to the generic errorGeneric string. Code 2 (user
// cancelled) never reaches here — the engine reports it as 'cancelled'.
export const ERROR_KEYS = {
  1: 'errorNotFound',
  3: 'errorUnavailable',
  4: 'errorSubUnavailable',
  6: 'errorNetwork',
  7: 'errorOwned',
}

/**
 * The notice a terminal billing event leaves on the paywall, or null for none.
 * Pure, so it can be tested: the paywall applies it from an effect, which a
 * server render never runs.
 *
 * 'pending' (@glance-apps/billing 0.2.4) ends a purchase that is neither
 * failed nor confirmed. Deferred: waiting for someone's approval (Ask to Buy).
 * Otherwise unconfirmed: the store completed it but the entitlement has not
 * appeared. Either way the app unlocks on its own when it does, from
 * RevenueCat's update, so the copy points at waiting, or at support, and
 * never at Restore, which would find nothing yet. Both strings are English in
 * every bundle until the locale pass translates them; UNTRANSLATED in
 * src/locales.test.js tracks who is waiting.
 */
export function noticeFor(billingEvent, t) {
  if (billingEvent.status === 'error') {
    return { kind: 'error', text: t(ERROR_KEYS[billingEvent.code] ?? 'errorGeneric') }
  }
  if (billingEvent.status === 'cancelled') {
    // Restore results arrive as 'cancelled' so UI clears its spinner without
    // treating them like a new purchase; a plain cancel stays silent.
    if (billingEvent.message === 'restore_complete') return { kind: 'info', text: t('restoreNone') }
    if (billingEvent.message === 'restore_complete_active') return { kind: 'info', text: t('restoreDone') }
    return null
  }
  if (billingEvent.status === 'pending') {
    return {
      kind: 'info',
      text: billingEvent.code === BILLING_CODE_PENDING
        ? t('purchasePendingApproval')
        : t('purchaseUnconfirmed'),
    }
  }
  return null
}
