import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useTypewriter } from '../../utils/typewriter'

export default function Step1Welcome({ onBegin }) {
  const { t } = useTranslation('onboarding')
  const TAGLINE = t('tagline')

  // Phase: 'life' → 'glance' → 'tagline' → 'cta'
  const [phase, setPhase] = useState('life')

  const lifeTyped   = useTypewriter('life',   { active: phase === 'life',   delay: 55, jitter: 40 })
  const glanceTyped = useTypewriter('GLANCE', { active: phase === 'glance', delay: 55, jitter: 40 })
  const taglineTyped = useTypewriter(TAGLINE,  { active: phase === 'tagline', delay: 30, jitter: 20, startDelay: 200 })

  useEffect(() => {
    if (lifeTyped.done   && phase === 'life')    setTimeout(() => setPhase('glance'),  120)
  }, [lifeTyped.done])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (glanceTyped.done && phase === 'glance')  setTimeout(() => setPhase('tagline'), 300)
  }, [glanceTyped.done]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (taglineTyped.done && phase === 'tagline') setTimeout(() => setPhase('cta'), 400)
  }, [taglineTyped.done]) // eslint-disable-line react-hooks/exhaustive-deps

  const showCta = phase === 'cta'

  // Demo-data loader — hosted-eval only. The whole block (handler + button) is
  // gated on the VITE_DEMO literal so it is dead-code-eliminated from every build
  // except the Vercel one. The fixture + seed logic live behind a dynamic import
  // so they are never pulled into the other bundles.
  async function handleLoadDemo() {
    if (!import.meta.env.VITE_DEMO) return
    if (!window.confirm('Load a sample timeline (a fictional persona) so you can explore lifeGLANCE with real content? You can clear it at any time.')) return
    const { loadDemo } = await import('../../demo/demo')
    await loadDemo()
    location.reload()
  }

  return (
    <div className="onboarding-step" style={{ alignItems: 'flex-start' }}>
      {/* Logo animation */}
      <div style={{ lineHeight: 1 }}>
        <div className="logo">
          <span className="logo-life">
            {phase === 'life' ? lifeTyped.displayed : 'life'}
            {phase === 'life' && <span className="cursor" />}
          </span>
          <span className="logo-glance">
            {phase === 'glance' ? glanceTyped.displayed : phase !== 'life' ? 'GLANCE' : ''}
            {phase === 'glance' && <span className="cursor" />}
          </span>
        </div>

        {/* Tagline */}
        <div className="logo-tagline" style={{ minHeight: '1.4rem' }}>
          {phase !== 'life' && phase !== 'glance' && (
            <>
              {taglineTyped.displayed}
              {phase === 'tagline' && <span className="cursor" />}
            </>
          )}
        </div>
      </div>

      {/* CTA */}
      <div
        style={{
          marginTop: '1rem',
          opacity: showCta ? 1 : 0,
          transform: showCta ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.4s ease, transform 0.4s ease',
        }}
      >
        <button className="btn" onClick={onBegin}>
          {t('begin')}
        </button>
        {import.meta.env.VITE_DEMO && (
          <div style={{ marginTop: '0.85rem' }}>
            <button className="onboarding-link" onClick={handleLoadDemo}>
              Load demo data
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
