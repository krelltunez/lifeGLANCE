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
import { useSubscription } from './billing/billing'
import PaywallModal from './components/billing/PaywallModal'
import ReviewerBanner from './components/billing/ReviewerBanner'

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

  // Demo-data state (hosted-eval only). Presence of the persisted demo-state key
  // means sample data is loaded and drives the persistent banner. The whole
  // feature is gated on the VITE_DEMO literal so it tree-shakes out of every
  // build except the Vercel one.
  // No setter: seed and clear both reload the page, so this is re-read on mount.
  const [demoLoaded] = useState(
    () => import.meta.env.VITE_DEMO && !!localStorage.getItem('lifeglance-demo-state')
  )

  async function handleClearDemo() {
    if (!import.meta.env.VITE_DEMO) return
    if (!window.confirm('Remove the sample data? Anything you created yourself will be kept.')) return
    const { clearDemo } = await import('./demo/demo')
    await clearDemo()
    // Reload WITHOUT the ?demo=1 param, or the deep-link auto-seed would just
    // re-seed on the now-empty timeline and Clear would appear to do nothing.
    const url = new URL(location.href)
    url.searchParams.delete('demo')
    location.replace(url.pathname + url.search + url.hash)
  }

  // Entitlement engine — inert (ungated, 'channel' source) everywhere except
  // the Play Android build, which is the only channel that gets an adapter.
  const billing = useSubscription()
  const [subscriptionOpen, setSubscriptionOpen] = useState(false)

  // A reviewer code unlocks the app but leaves no way back to the paywall — the
  // only surface that shows the in-app purchases. The billing engine exposes no
  // revoke, so clear the reviewer-unlock key directly and reload; with no
  // entitlement the gate (and the IAPs) returns. See docs/reviewer-access-flow.md.
  const exitReviewerMode = () => {
    try { localStorage.removeItem('glance-billing.reviewer-unlock') } catch { /* storage unavailable */ }
    location.reload()
  }

  // Dev-only: force the paywall on the web build so the gate + reviewer flow can
  // be exercised with `npm run dev` (visit /?wall). The real gate is
  // Play-Android-only, and the ungated engine always reports isUnlocked, so this
  // path can't key off it — show unless already reviewer-unlocked.
  const devWall = import.meta.env.DEV && new URLSearchParams(location.search).has('wall')

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
        // ?demo=1 deep link — auto-seed the sample timeline, subject to the build
        // gate AND the empty-timeline condition (never clobbers real data), then
        // reload so the rest of this init runs against the seeded store. Already
        // seeded (or non-empty) falls through to the normal path.
        if (
          import.meta.env.VITE_DEMO &&
          all.length === 0 &&
          !localStorage.getItem('lifeglance-demo-state') &&
          new URLSearchParams(location.search).get('demo') === '1'
        ) {
          import('./demo/demo').then(async ({ loadDemo }) => {
            await loadDemo()
            location.reload()
          })
          return
        }

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
        initDbSyncEngine({
          setMilestones,
          setChapters,
          // Vault intents/blob key can't be derived without the passphrase. When
          // it's missing and vault intents are in use, prompt for it (same modal
          // the WebDAV engine uses); onUnlocked re-runs the DB sync to derive it.
          onPassphraseRequired: () => setShowPassphraseModal(true),
        })

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
      onOpenSubscription={billing.gated ? () => setSubscriptionOpen(true) : undefined}
      licenseSource={billing.gated ? billing.entitlementSource : null}
    />
  )

  return (
    <>
      {content}
      {/* Persistent sample-data banner (hosted-eval only). Gated on the VITE_DEMO
          literal so the whole block is stripped from every non-Vercel build. */}
      {import.meta.env.VITE_DEMO && demoLoaded && screen === 'timeline' && (
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
          <span style={{ fontWeight: 600 }}>
            Sample data — this is a fictional demo timeline, not your own.
          </span>
          <button
            onClick={handleClearDemo}
            style={{
              fontSize: '0.7rem', padding: '0.25rem 0.75rem', borderRadius: '999px',
              background: 'var(--amber-bright)', color: 'var(--bg)',
              fontWeight: 700, border: 'none', cursor: 'pointer',
            }}
          >
            Clear sample data
          </button>
        </div>
      )}
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
            // Now that the passphrase is in session, run the DB sync too so the
            // vault intents/blob key derives (bootstrapIntentsRootKey) and held
            // intents flush.
            getDbSyncEngine()?.sync()
          }}
        />
      )}
      {subscriptionOpen && (
        <PaywallModal mode="status" billing={billing} onClose={() => setSubscriptionOpen(false)} />
      )}
      {/* Reviewer-only banner with a way back to the paywall (the sole IAP
          surface). Shown only when unlocked via a reviewer code, never for
          purchasers. Never coincident with the gate — exiting reloads. */}
      {billing.isReviewerUnlocked && (
        <ReviewerBanner onExit={exitReviewerMode} />
      )}
      {/* The hard gate renders last so it covers every other surface. The
          engine handles offline/anti-flash itself — gate on isUnlocked only.
          The devWall branch forces it in a dev web build (see above). */}
      {((billing.gated && !billing.isUnlocked) || (devWall && !billing.isReviewerUnlocked)) && (
        <PaywallModal mode="gate" billing={billing} />
      )}
    </>
  )
}
