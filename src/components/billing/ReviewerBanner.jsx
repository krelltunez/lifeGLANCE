import React from 'react'
import { useTranslation } from 'react-i18next'

// Persistent top banner shown ONLY while the app is unlocked via a reviewer code
// (billing.isReviewerUnlocked) — never for genuine purchasers, who are entitled
// through the store. Its action returns to the paywall, which is the only surface
// that shows the in-app purchases: without a way back, a reviewer who used the
// code "cannot locate the IAPs" and the app is rejected under App Review 2.1(b).
// See docs/reviewer-access-flow.md. Colours use --amber-rgb / --amber-bright,
// which already adapt to light/dark.
export default function ReviewerBanner({ onExit }) {
  const { t } = useTranslation('billing')
  return (
    <div
      role="status"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
        gap: '0.35rem 0.9rem', padding: '0.4rem 1rem',
        fontSize: '0.72rem', lineHeight: 1.3,
        background: 'rgba(var(--amber-rgb), 0.18)',
        color: 'var(--amber-bright)',
        borderBottom: '1px solid rgba(var(--amber-rgb), 0.4)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M12 3l7 3v5c0 4.4-3 7.9-7 9-4-1.1-7-4.6-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t('reviewerBannerText')}
      </span>
      <button
        onClick={onExit}
        style={{
          fontSize: '0.7rem', padding: '0.25rem 0.75rem', borderRadius: '999px',
          background: 'var(--amber-bright)', color: 'var(--bg)',
          fontWeight: 700, border: 'none', cursor: 'pointer',
        }}
      >
        {t('reviewerExitPlans')}
      </button>
    </div>
  )
}
