import React, { useState, useEffect, useRef, useCallback } from 'react'
import Onboarding   from './components/onboarding/Onboarding'
import TimelineView from './components/timeline/TimelineView'
import CloudSyncModal from './components/sync/CloudSyncModal'
import SyncPassphraseModal from './components/sync/SyncPassphraseModal'
import { initDB, dbGetAll, dbGetAllChapters } from './data/db'
import { initSyncEngine, getSyncEngine } from './sync/engine'

export default function App() {
  const [screen,      setScreen]      = useState('loading')  // loading | onboarding | timeline
  const [milestones,  setMilestones]  = useState([])
  const [chapters,    setChapters]    = useState([])
  const [syncStatus,  setSyncStatus]  = useState('idle')
  const [syncError,   setSyncError]   = useState(null)
  const [syncHalted,  setSyncHalted]  = useState(false)
  const [lastSynced,  setLastSynced]  = useState(null)
  const [showPassphraseModal, setShowPassphraseModal] = useState(false)
  const [cloudSyncOpen, setCloudSyncOpen] = useState(false)

  const [portraitWarn, setPortraitWarn] = useState(
    () => window.matchMedia('(orientation: portrait) and (max-width: 1024px)').matches
  )

  const milestonesRef = useRef(milestones)
  const chaptersRef   = useRef(chapters)

  // Keep refs in sync with state every render
  useEffect(() => { milestonesRef.current = milestones }, [milestones])
  useEffect(() => { chaptersRef.current = chapters }, [chapters])

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait) and (max-width: 1024px)')
    const handler = (e) => setPortraitWarn(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    initDB()
      .then(() => {
        if (import.meta.env.DEV) import('./data/devtools').then(m => m.registerDevtools())
        navigator.storage?.persist?.()
        return Promise.all([dbGetAll(), dbGetAllChapters()])
      })
      .then(([all, allChapters]) => {
        setMilestones(all)
        setChapters(allChapters)
        setScreen(all.length === 0 ? 'onboarding' : 'timeline')

        // Initialize sync engine after IDB is ready
        initSyncEngine({
          milestonesRef,
          chaptersRef,
          setMilestones,
          setChapters,
          setSyncStatus,
          setSyncError,
          setSyncHalted,
          setLastSynced,
          setShowPassphraseModal,
        })
      })
      .catch((err) => {
        console.error('DB init failed:', err)
        setScreen('onboarding')
      })
  }, [])

  // Sync interval — trigger sync every 60 seconds with a random initial jitter
  // so multiple browser windows don't stay phase-locked after a hot reload.
  useEffect(() => {
    const jitter = Math.random() * 30_000
    let id
    const t = setTimeout(() => {
      getSyncEngine()?.sync()
      id = setInterval(() => getSyncEngine()?.sync(), 60_000)
    }, jitter)
    return () => { clearTimeout(t); clearInterval(id) }
  }, [])

  // Upload on data changes (debounced 5s)
  const uploadTimerRef = useRef(null)
  useEffect(() => {
    if (screen !== 'timeline') return
    if (uploadTimerRef.current) clearTimeout(uploadTimerRef.current)
    uploadTimerRef.current = setTimeout(() => {
      getSyncEngine()?.upload()
    }, 5_000)
    return () => clearTimeout(uploadTimerRef.current)
  }, [milestones, chapters, screen])

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
    <TimelineView
      milestones={milestones}
      setMilestones={setMilestones}
      chapters={chapters}
      setChapters={setChapters}
      syncStatus={syncStatus}
      syncError={syncError}
      syncHalted={syncHalted}
      lastSynced={lastSynced}
      onOpenCloudSync={() => setCloudSyncOpen(true)}
    />
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
          <div className="portrait-rotate-icon">&#x21BA;</div>
          <div className="portrait-message">
            please rotate your device<br />
            for the best experience
          </div>
        </div>
      )}
      {cloudSyncOpen && (
        <CloudSyncModal
          syncStatus={syncStatus}
          syncError={syncError}
          syncHalted={syncHalted}
          lastSynced={lastSynced}
          onClose={() => setCloudSyncOpen(false)}
        />
      )}
      {showPassphraseModal && (
        <SyncPassphraseModal
          onClose={() => setShowPassphraseModal(false)}
          onUnlocked={() => {
            setShowPassphraseModal(false)
            getSyncEngine()?.sync()
          }}
        />
      )}
    </>
  )
}
