import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useTypewriter } from '../../utils/typewriter'

export default function Step1Welcome({ onBegin, onSkip }) {
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
      </div>

      <button className="skip-link" onClick={onSkip}>
        {t('skip', { ns: 'common' })}
      </button>
    </div>
  )
}
