import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Step1Welcome   from './Step1Welcome'
import Step2Past      from './Step2Past'
import Step3Future    from './Step3Future'
import Step4Reveal    from './Step4Reveal'
import TimelinePreview from './TimelinePreview'
import ThemeToggle    from '../ui/ThemeToggle'
import { addMilestone } from '../../data/milestones'
import { init as audioInit, startAmbient, stopAmbient } from '../../utils/audio'

// Forward chevron, matching the line-icon style of the theme toggle.
function SkipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 17 5-5-5-5" />
      <path d="m13 17 5-5-5-5" />
    </svg>
  )
}

export default function Onboarding({ onComplete }) {
  const { t: tc } = useTranslation('common')
  const [step, setStep]               = useState(1)
  const [pastMilestone, setPast]      = useState(null)
  const [futureMilestone, setFuture]  = useState(null)

  function handleBegin() {
    audioInit()       // unlock AudioContext on this user gesture
    startAmbient()    // start soft drone
    setStep(2)
  }

  async function handlePast(data) {
    const m = await addMilestone(data)
    setPast(m)
    setStep(3)
  }

  async function handleFuture(data) {
    const m = await addMilestone(data)
    setFuture(m)
    setStep(4)
  }

  function finish() {
    stopAmbient()     // fade out drone as we enter the timeline
    onComplete([pastMilestone, futureMilestone].filter(Boolean))
  }

  const previewMilestones = [pastMilestone, futureMilestone].filter(Boolean)

  return (
    <div className={`onboarding${step === 1 ? ' onboarding-welcome' : ''}`}>
      {step === 1 && <Step1Welcome onBegin={handleBegin} />}
      {step === 2 && <Step2Past    onSubmit={handlePast} />}
      {step === 3 && <Step3Future  onSubmit={handleFuture} pastMilestone={pastMilestone} />}
      {step === 4 && <Step4Reveal  onComplete={finish} pastMilestone={pastMilestone} futureMilestone={futureMilestone} />}

      {/* Timeline preview strip appears from step 2 onwards */}
      {step >= 2 && <TimelinePreview milestones={previewMilestones} />}

      {/* Theme toggle + skip, fixed in the corner while there's still a step to skip */}
      {step <= 3 && (
        <div className="onboarding-corner">
          <ThemeToggle />
          <span className="onboarding-sep" aria-hidden="true" />
          <button className="onboarding-link" onClick={finish}>
            <SkipIcon />
            {tc('skip')}
          </button>
        </div>
      )}
    </div>
  )
}
