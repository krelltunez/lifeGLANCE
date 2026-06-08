import React, { useState, useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import TypewriterText from '../ui/TypewriterText'
import { useCountUp } from '../../utils/typewriter'
import { getYearsMonths } from '../../utils/dates'

export default function Step4Reveal({ onComplete, pastMilestone, futureMilestone }) {
  const { t } = useTranslation('onboarding')
  const [phase, setPhase] = useState('typing') // typing → row1 → row2 → cta

  // Derived time distances
  const pastInfo   = pastMilestone   ? getYearsMonths(pastMilestone.date)   : null
  const futureInfo = futureMilestone ? getYearsMonths(futureMilestone.date) : null

  // Count-up values
  const pastYears   = useCountUp(pastInfo?.years   ?? 0, { active: phase !== 'typing', duration: 1100 })
  const pastMonths  = useCountUp(pastInfo?.months  ?? 0, { active: phase !== 'typing', duration: 900,  delay: 800 })
  const futureYears  = useCountUp(futureInfo?.years  ?? 0, { active: phase === 'row2' || phase === 'cta', duration: 1100 })
  const futureMonths = useCountUp(futureInfo?.months ?? 0, { active: phase === 'row2' || phase === 'cta', duration: 900, delay: 800 })
  const futureDays   = useCountUp(futureInfo?.days   ?? 0, { active: phase === 'row2' || phase === 'cta', duration: 1100 })

  function handleTypingDone() {
    setTimeout(() => setPhase('row1'), 600)
  }

  useEffect(() => {
    if (phase === 'row1') setTimeout(() => setPhase('row2'), 1400)
  }, [phase])

  useEffect(() => {
    if (phase === 'row2') setTimeout(() => setPhase('cta'), 1400)
  }, [phase])

  const formatFutureTime = () => {
    if (!futureInfo) return '—'
    if (futureInfo.years > 0) {
      const yr = `${futureYears} yr${futureInfo.years !== 1 ? 's' : ''}`
      return futureInfo.months > 0
        ? `in ${yr}, ${futureMonths} mo`
        : `in ${yr}`
    }
    return `in ${futureDays} day${futureInfo.days !== 1 ? 's' : ''}`
  }

  const formatPastTime = () => {
    if (!pastInfo) return '—'
    if (pastInfo.years > 0) {
      const yr = `${pastYears} yr${pastInfo.years !== 1 ? 's' : ''}`
      return pastInfo.months > 0
        ? `${yr}, ${pastMonths} mo ago`
        : `${yr} ago`
    }
    return `${pastInfo.days} days ago`
  }

  return (
    <div className="onboarding-step">
      <div>
        <div className="progress-dots">
          <div className="progress-dot done" />
          <div className="progress-dot done" />
          <div className="progress-dot done" />
          <div className="progress-dot active" />
        </div>
        <div className="onboarding-eyebrow" style={{ marginTop: '0.5rem' }}>
          {t('step4Eyebrow')}
        </div>
      </div>

      <div className="onboarding-prompt">
        <TypewriterText
          text={t('step4Prompt')}
          options={{ delay: 40, jitter: 20, startDelay: 300 }}
          onDone={handleTypingDone}
          hideCursorWhenDone
          playSound
        />
      </div>

      {/* Stat rows */}
      <div className="stat-reveal-rows">
        {/* Past stat */}
        <div className={`stat-reveal-row ${phase !== 'typing' ? 'visible' : ''}`}>
          <div className="stat-reveal-label">{t('lookingBack')}</div>
          <div className="stat-reveal-value">
            {pastMilestone
              ? <>{pastMilestone.title} — <em>{formatPastTime()}</em></>
              : <span style={{ color: 'var(--text-muted)' }}>{t('noPastEvent')}</span>
            }
          </div>
        </div>

        {/* Future stat */}
        <div className={`stat-reveal-row ${phase === 'row2' || phase === 'cta' ? 'visible' : ''}`}>
          <div className="stat-reveal-label">{t('lookingAhead')}</div>
          <div className="stat-reveal-value">
            {futureMilestone
              ? <>{futureMilestone.title} — <em>{formatFutureTime()}</em></>
              : <span style={{ color: 'var(--text-muted)' }}>{t('noFutureEvent')}</span>
            }
          </div>
        </div>
      </div>

      {/* CTA */}
      <div
        style={{
          opacity:    phase === 'cta' ? 1 : 0,
          transform:  phase === 'cta' ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.4s ease, transform 0.4s ease',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        <button className="btn btn-filled" onClick={onComplete}>
          {t('openTimeline')}
        </button>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: "'Courier Prime', monospace" }}>
          <Trans ns="onboarding" i18nKey="keyboardShortcutHint"
            components={{ kbd: <kbd style={{ fontSize: '0.85em', padding: '0.1em 0.35em', borderRadius: 3, border: '1px solid var(--border)', color: 'var(--text-dim)' }}>?</kbd> }}
          />
        </div>
      </div>
    </div>
  )
}
