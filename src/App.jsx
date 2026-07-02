import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Onboarding   from './components/onboarding/Onboarding'
import TimelineView from './components/timeline/TimelineView'
import CloudSyncModal from './components/sync/CloudSyncModal'
import SyncPassphraseModal from './components/sync/SyncPassphraseModal'
import { initDB, dbGetAll, dbGetAllChapters } from './data/db'
import { backfillMediaIds } from './data/milestones'
import { initSyncEngine, getSyncEngine } from './sync/engine'
import { initDbSyncEngine, getDbSyncEngine } from './sync/dbSync'
import { buildWidgetSnapshot } from './utils/widgetSnapshot'
import { pushWidgetSnapshot } from './native/widgetBridge'

export default function App() {
  const { t } = useTranslation('common')
  const [screen,      setScreen]      = useState('loading')  // loading | onboarding | timeline
  const [milestones,  setMilestones]  = useState([])
  const [chapters,    setChapters]    = useState([])
  const [syncStatus,  setSyncStatus]  = useState('idle')
  const [syncError,   setSyncError]   = useState(null)
  const [syncHalted,  setSyncHalted]  = useState(false)
  const [lastSynced,  setLastSynced]  = useState(null)
  // Per-row quarantine signal from the sync engine: { count, entityIds, at } | null.
  // Drives a transient toast (TimelineView) and a durable amber note (CloudSyncModal).
  const [vaultSkipped, setVaultSkipped] = useState(null)
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

  // Reload milestones from the store on demand — e.g. after the media backfill
  // writes real-hash slots, so the newly vault-backed media appears immediately.
  useEffect(() => {
    const reload = () => { dbGetAll().then(setMilestones).catch(() => {}) }
    window.addEventListener('lifeglance:milestones-reload', reload)
    return () => window.removeEventListener('lifeglance:milestones-reload', reload)
  }, [])

  useEffect(() => {
    initDB()
      .then(() => {
        if (import.meta.env.DEV) import('./data/devtools').then(m => m.registerDevtools())
        navigator.storage?.persist?.()
        return backfillMediaIds().then(() => Promise.all([dbGetAll(), dbGetAllChapters()]))
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
          setVaultSkipped,
        })

        // GLANCEvault database-sync engine, constructed ALONGSIDE the WebDAV
        // engine above. Returns null (fully inert) unless the vault is enabled in
        // the cloud-sync config — vault sync is opt-in and never replaces WebDAV.
        initDbSyncEngine({ setMilestones, setChapters })

        // Restore encryption session key from IDB so the passphrase prompt
        // only appears when the key genuinely isn't stored (first setup or
        // new device), not on every page load.
        import('@glance-apps/sync').then(({ initSessionKey }) => {
          initSessionKey({ cryptoDBName: 'lifeglance-crypto' })
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
      getDbSyncEngine()?.sync()
      id = setInterval(() => { getSyncEngine()?.sync(); getDbSyncEngine()?.sync() }, 60_000)
    }, jitter)
    return () => { clearTimeout(t); clearInterval(id) }
  }, [])

  // Auto-backup timer — checks every 60s if a scheduled backup is due.
  // Skips if cloud sync encryption is configured but the session key isn't loaded yet
  // (avoids writing unencrypted backup files).
  useEffect(() => {
    const INTERVALS = { hourly: 3_600_000, daily: 86_400_000, weekly: 604_800_000 }
    const tick = async () => {
      try {
        const backupCfg = JSON.parse(localStorage.getItem('lifeglance-auto-backup-config') ?? 'null')
        if (!backupCfg?.remoteEnabled) return
        const freq = backupCfg.frequency ?? 'daily'
        const interval = INTERVALS[freq] ?? INTERVALS.daily
        const lastKey = `lifeglance-backup-last-${freq}`
        const last = Number(localStorage.getItem(lastKey) ?? '0')
        if (Date.now() - last < interval) return
        const engine = getSyncEngine()
        const syncCfg = engine?.getConfig()
        if (!syncCfg?.enabled) return
        if (syncCfg?.encrypt && !engine?.hasEncryptionReady?.()) return
        await engine?.runBackup(freq)
        localStorage.setItem(lastKey, String(Date.now()))
      } catch (err) {
        console.error('[auto-backup]', err)
      }
    }
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  // Upload on data changes (debounced 5s)
  const uploadTimerRef = useRef(null)
  useEffect(() => {
    if (screen !== 'timeline') return
    if (uploadTimerRef.current) clearTimeout(uploadTimerRef.current)
    uploadTimerRef.current = setTimeout(() => {
      getSyncEngine()?.upload()
    }, 5_000)
    // Push-on-write for the vault tier: a debounced vault-only push so a local
    // edit reaches GLANCEvault promptly (even on a backgrounded device) without
    // waiting for the 60s cycle or an app reopen. No-op when vault is disabled.
    getDbSyncEngine()?.pushDebounced()
    return () => clearTimeout(uploadTimerRef.current)
  }, [milestones, chapters, screen])

  // Push a render-ready snapshot to the native home-screen widgets. Debounced on
  // data changes (parallel to the sync upload above), and flushed immediately when
  // the app backgrounds so the widget reflects the latest state by the time the
  // user is looking at the home screen. No-op on web. Reading birthday from
  // localStorage here keeps this independent of TimelineView's local copy.
  const widgetTimerRef = useRef(null)
  useEffect(() => {
    if (screen !== 'timeline') return

    const flush = () => {
      const birthday = localStorage.getItem('lifeglance-birthday') || null
      let pins = {}
      try { pins = JSON.parse(localStorage.getItem('lifeglance-pins') || '{}') } catch { /* ignore malformed pins */ }
      pushWidgetSnapshot(
        buildWidgetSnapshot(milestonesRef.current, chaptersRef.current, birthday, new Date(), pins)
      )
    }

    if (widgetTimerRef.current) clearTimeout(widgetTimerRef.current)
    widgetTimerRef.current = setTimeout(flush, 1_000)

    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onHide)
    // Settings that aren't part of milestones/chapters (e.g. birthday) dispatch this
    // event so the widget snapshot re-pushes immediately rather than waiting for the
    // next data change or app background.
    window.addEventListener('lifeglance:widget-refresh', flush)
    return () => {
      clearTimeout(widgetTimerRef.current)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('lifeglance:widget-refresh', flush)
    }
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
      vaultSkipped={vaultSkipped}
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
            {t('portraitMessage')}
          </div>
        </div>
      )}
      {cloudSyncOpen && (
        <CloudSyncModal
          syncStatus={syncStatus}
          syncError={syncError}
          syncHalted={syncHalted}
          lastSynced={lastSynced}
          vaultSkipped={vaultSkipped}
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
