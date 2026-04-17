import React, { useState, useEffect } from 'react'
import Onboarding   from './components/onboarding/Onboarding'
import TimelineView from './components/timeline/TimelineView'
import { initDB, dbGetAll } from './data/db'

export default function App() {
  const [screen,      setScreen]      = useState('loading')  // loading | onboarding | timeline
  const [milestones,  setMilestones]  = useState([])
  const [portraitWarn, setPortraitWarn] = useState(
    () => window.matchMedia('(orientation: portrait) and (max-width: 1024px)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait) and (max-width: 1024px)')
    const handler = (e) => setPortraitWarn(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    initDB()
      .then(() => { navigator.storage?.persist?.(); return dbGetAll() })
      .then((all) => {
        setMilestones(all)
        setScreen(all.length === 0 ? 'onboarding' : 'timeline')
      })
      .catch((err) => {
        console.error('DB init failed:', err)
        setScreen('onboarding')
      })
  }, [])

  function handleOnboardingComplete(initial) {
    setMilestones(initial)
    setScreen('timeline')
  }

  const content = screen === 'loading' ? (
    <div className="app-loading">
      <span className="cursor" style={{ width: '8px', height: '8px', borderRadius: '50%' }} />
    </div>
  ) : screen === 'onboarding' ? (
    <Onboarding onComplete={handleOnboardingComplete} />
  ) : (
    <TimelineView milestones={milestones} setMilestones={setMilestones} />
  )

  return (
    <>
      {content}
      {portraitWarn && (
        <div className="portrait-overlay">
          <div className="logo">
            <span className="logo-life">life</span>
            <span className="logo-glance">GLANCE</span>
          </div>
          <div className="portrait-rotate-icon">↺</div>
          <div className="portrait-message">
            please rotate your device<br />
            for the best experience
          </div>
        </div>
      )}
    </>
  )
}
