import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MANAGE_SUBSCRIPTION_URL, PRODUCT_IDS, STORE_NAME, TRIAL_FALLBACK_DAYS } from '../../billing/billing'

// Localized messages for the billing error codes the package maps; anything
// else falls through to the generic errorGeneric string. Code 2 (user
// cancelled) never reaches here — the engine reports it as 'cancelled'.
const ERROR_KEYS = {
  1: 'errorNotFound',
  3: 'errorUnavailable',
  4: 'errorSubUnavailable',
  6: 'errorNetwork',
  7: 'errorOwned',
}

// Paywall surface for gated (Play) builds, in two modes:
//
// - mode='gate'   — the hard gate rendered at the app root while locked. Not
//   dismissible: no close affordance, overlay clicks ignored. Unlocking (a
//   purchase, restore, or reviewer code) flips isUnlocked and the app unmounts
//   it — the modal never closes itself.
// - mode='status' — the settings surface: shows why the install is unlocked,
//   a manage-subscription link for subscribers, and Restore.
//
// All price and trial copy is store-driven (billing.prices / trialDays); no
// amounts or trial lengths are hardcoded anywhere.
export default function PaywallModal({ mode = 'gate', billing, onClose }) {
  const { t } = useTranslation('billing')
  const {
    isPro, entitlementSource, prices, trialEligible, trialDays,
    billingEvent, subscribe, restore, clearBillingEvent, setReviewerUnlocked,
  } = billing

  const gate = mode === 'gate'
  const [purchasing,      setPurchasing]      = useState(false)
  const [reviewerOpen,    setReviewerOpen]    = useState(false)
  const [reviewerCode,    setReviewerCode]    = useState('')
  const [reviewerInvalid, setReviewerInvalid] = useState(false)
  const [notice,          setNotice]          = useState(null) // { kind: 'error'|'info', text }

  // Every purchase/restore ends in a terminal billingEvent — translate it to a
  // notice (or silence) and clear the spinner state.
  useEffect(() => {
    if (!billingEvent) return
    setPurchasing(false)
    if (billingEvent.status === 'error') {
      setNotice({ kind: 'error', text: t(ERROR_KEYS[billingEvent.code] ?? 'errorGeneric') })
    } else if (billingEvent.status === 'cancelled') {
      // Restore results arrive as 'cancelled' so UI clears its spinner without
      // treating them like a new purchase; a plain cancel stays silent.
      if (billingEvent.message === 'restore_complete') {
        setNotice({ kind: 'info', text: t('restoreNone') })
      } else if (billingEvent.message === 'restore_complete_active') {
        setNotice({ kind: 'info', text: t('restoreDone') })
      } else {
        setNotice(null)
      }
    } else {
      setNotice(null)
    }
    clearBillingEvent()
  }, [billingEvent, clearBillingEvent, t])

  // Status mode closes on Escape like every other sheet; the gate does not.
  useEffect(() => {
    if (gate || !onClose) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [gate, onClose])

  function buy(productId) {
    setNotice(null)
    setPurchasing(true)
    subscribe(productId)
  }

  async function applyReviewerCode() {
    const ok = await setReviewerUnlocked(reviewerCode.trim())
    setReviewerInvalid(!ok)
  }

  // Trial copy leads with the length: the store-reported trialDays wins once
  // it arrives, TRIAL_FALLBACK_DAYS (the configured Play offer) fills in while
  // the store hasn't answered, and a determinately-ineligible user gets the
  // non-trial headline with NO trial claims (the Play sheet won't grant one).
  const shownTrialDays = trialDays ?? TRIAL_FALLBACK_DAYS
  const headline = trialEligible ? t('trialHeadline', { count: shownTrialDays }) : t('headline')

  const annualLabel = prices.yearly
    ? t(trialEligible ? 'annualButtonTrial' : 'annualButton', { price: prices.yearly })
    : t('annualButtonNoPrice')

  const lifetimeLabel = prices.lifetime
    ? t('lifetimeButton', { price: prices.lifetime })
    : t('lifetimeButtonNoPrice')

  const statusKey = {
    lifetime:     'statusLifetime',
    subscription: 'statusSubscription',
    reviewer:     'statusReviewer',
    channel:      'statusChannel',
    none:         'statusNone',
  }[entitlementSource]

  const purchaseSection = (
    <>
      <div className="paywall-plans">
        <button className="btn btn-filled paywall-plan-btn"
          disabled={purchasing}
          onClick={() => buy(PRODUCT_IDS.yearly)}>
          {annualLabel}
        </button>
        <button className="btn paywall-plan-btn"
          disabled={purchasing}
          onClick={() => buy(PRODUCT_IDS.lifetime)}>
          {lifetimeLabel}
        </button>
      </div>
      {trialEligible && prices.yearly && (
        <p className="settings-note paywall-note">{t('renewalExplainer', { price: prices.yearly })}</p>
      )}
      <p className="settings-note paywall-note">{t('paymentNote', { store: STORE_NAME })}</p>
    </>
  )

  return (
    <div className="sheet-overlay paywall-overlay"
      onClick={e => { if (!gate && onClose && e.target === e.currentTarget) onClose() }}>
      <div className="sheet paywall-sheet">
        {!gate && (
          <div className="sheet-header">
            <span className="sheet-title">{t('title')}</span>
            {onClose && (
              <button className="sheet-close" onClick={onClose}>✕</button>
            )}
          </div>
        )}

        {gate ? (
          <>
            <div className="paywall-hero">
              <div className="logo logo-sm">
                <span className="logo-life">life</span>
                <span className="logo-glance">GLANCE</span>
              </div>
              <div className="paywall-tagline">{t('tagline')}</div>
              <div className="paywall-headline">{headline}</div>
              {trialEligible && (
                <div className="paywall-subline">{t('trialSubline', { count: shownTrialDays })}</div>
              )}
            </div>
            {purchaseSection}
          </>
        ) : (
          <div className="settings-section paywall-status-section">
            <div className="settings-label">{t('statusLabel')}</div>
            <div className="paywall-status-line">{t(statusKey)}</div>
            {entitlementSource === 'subscription' && (
              <button className="btn paywall-row-btn"
                onClick={() => window.open(MANAGE_SUBSCRIPTION_URL, '_blank')}>
                {t('manage')}
              </button>
            )}
            {!isPro && entitlementSource !== 'channel' && purchaseSection}
          </div>
        )}

        {notice && (
          <p className={`paywall-notice ${notice.kind === 'error' ? 'paywall-notice-error' : ''}`}>
            {notice.text}
          </p>
        )}

        <div className="paywall-footer">
          <button className="btn paywall-row-btn" disabled={purchasing} onClick={() => { setNotice(null); restore() }}>
            {t('restore')}
          </button>
        </div>

        {gate && (
          <div className="paywall-reviewer">
            {reviewerOpen ? (
              <>
                <div className="paywall-reviewer-row">
                  <input
                    className="input input-sm"
                    placeholder={t('reviewerPlaceholder')}
                    value={reviewerCode}
                    onChange={e => { setReviewerCode(e.target.value); setReviewerInvalid(false) }}
                    onKeyDown={e => { if (e.key === 'Enter' && reviewerCode.trim()) applyReviewerCode() }}
                    autoFocus
                  />
                  <button className="btn"
                    disabled={!reviewerCode.trim()}
                    onClick={applyReviewerCode}>
                    {t('reviewerApply')}
                  </button>
                </div>
                {reviewerInvalid && (
                  <p className="paywall-notice paywall-notice-error">{t('reviewerInvalid')}</p>
                )}
                <p className="settings-note paywall-note">{t('reviewerHelper')}</p>
              </>
            ) : (
              <button className="paywall-reviewer-toggle" onClick={() => setReviewerOpen(true)}>
                {t('reviewerToggle')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
