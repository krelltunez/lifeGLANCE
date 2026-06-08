import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateDisplay } from '../../utils/dates'
import TypewriterText from '../ui/TypewriterText'
import AnimatedRelLabel from '../ui/AnimatedRelLabel'

function StatMilestone({ m, align }) {
  const dateStr = formatDateDisplay(m.date, m.date_precision)
  const k = m.id + (m.updated_at || '')

  const [readyForKey, setReadyForKey] = useState(null)
  const labelReady = readyForKey === k

  return (
    <div className={`stat-milestone ${align === 'right' ? 'stat-milestone-right' : ''}`}>
      <div className="stat-milestone-title">
        <TypewriterText key={k + 'title'} text={m.title}
          options={{ delay: 18, jitter: 10 }} showCursor={false} />
      </div>
      <div className="stat-milestone-date">
        <TypewriterText key={k + 'date'} text={dateStr}
          options={{ delay: 14, jitter: 6, startDelay: 180 }} showCursor={false}
          onDone={() => setReadyForKey(k)} />
      </div>
      <div className="stat-milestone-rel">
        {labelReady && <AnimatedRelLabel key={k} dateStr={m.date} />}
      </div>
    </div>
  )
}

function NavRow({ idx, total, onChange, align, flip = false }) {
  if (total <= 1) return null
  const prev = flip ? (idx + 1) % total        : (idx - 1 + total) % total
  const next = flip ? (idx - 1 + total) % total : (idx + 1) % total
  return (
    <div className={`stat-nav-row ${align === 'right' ? 'stat-nav-row-right' : ''}`}>
      <button className="stat-nav-btn" onClick={() => onChange(prev)}>←</button>
      <span className="stat-nav-pos">{idx + 1}/{total}</span>
      <button className="stat-nav-btn" onClick={() => onChange(next)}>→</button>
    </div>
  )
}

export default function StatsPanel({ past, future, pastIdx, futureIdx, onPastChange, onFutureChange, viewMode = 'all', compact = false }) {
  const { t } = useTranslation('stats')
  const pastSwipeX   = useRef(null)
  const futureSwipeX = useRef(null)
  const [pastOpen,   setPastOpen]   = useState(false)
  const [futureOpen, setFutureOpen] = useState(false)
  const SWIPE = 40

  const showPast   = viewMode !== 'future'
  const showFuture = viewMode !== 'past'

  if (compact) {
    return (
      <div className="stat-panels" style={viewMode === 'future' ? { justifyContent: 'flex-end' } : undefined}>
        {showPast && (
          <div className="stat-pill-wrap">
            <button className={`stat-pill${pastOpen ? ' stat-pill-active' : ''}`}
              onClick={() => setPastOpen(o => !o)}>
              {t('pastLabel')}
            </button>
            {pastOpen && (
              <div className="stat-panel stat-panel-popup"
                onTouchStart={e => { pastSwipeX.current = e.touches[0].clientX }}
                onTouchEnd={e => {
                  if (pastSwipeX.current === null || past.length <= 1) return
                  const dx = e.changedTouches[0].clientX - pastSwipeX.current
                  if      (dx < -SWIPE) onPastChange((pastIdx + 1) % past.length)
                  else if (dx >  SWIPE) onPastChange((pastIdx - 1 + past.length) % past.length)
                  pastSwipeX.current = null
                }}
              >
                <div className="stat-panel-count">
                  {t('milestoneCount', { count: past.length })}
                </div>
                <NavRow idx={pastIdx} total={past.length} onChange={onPastChange} align="left" flip />
                {past[pastIdx] && <StatMilestone m={past[pastIdx]} align="left" />}
              </div>
            )}
          </div>
        )}
        {showFuture && (
          <div className="stat-pill-wrap stat-pill-wrap-right">
            <button className={`stat-pill${futureOpen ? ' stat-pill-active' : ''}`}
              onClick={() => setFutureOpen(o => !o)}>
              {t('futureLabel')}
            </button>
            {futureOpen && (
              <div className="stat-panel stat-panel-right stat-panel-popup"
                onTouchStart={e => { futureSwipeX.current = e.touches[0].clientX }}
                onTouchEnd={e => {
                  if (futureSwipeX.current === null || future.length <= 1) return
                  const dx = e.changedTouches[0].clientX - futureSwipeX.current
                  if      (dx < -SWIPE) onFutureChange((futureIdx + 1) % future.length)
                  else if (dx >  SWIPE) onFutureChange((futureIdx - 1 + future.length) % future.length)
                  futureSwipeX.current = null
                }}
              >
                <div className="stat-panel-count">
                  {t('milestoneCount', { count: future.length })}
                </div>
                <NavRow idx={futureIdx} total={future.length} onChange={onFutureChange} align="right" />
                {future[futureIdx] && <StatMilestone m={future[futureIdx]} align="right" />}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="stat-panels" style={viewMode === 'future' ? { justifyContent: 'flex-end' } : undefined}>
      {/* Left — past */}
      {showPast && <div className="stat-panel"
        onTouchStart={e => { pastSwipeX.current = e.touches[0].clientX }}
        onTouchEnd={e => {
          if (pastSwipeX.current === null || past.length <= 1) return
          const dx = e.changedTouches[0].clientX - pastSwipeX.current
          if      (dx < -SWIPE) onPastChange((pastIdx + 1) % past.length)
          else if (dx >  SWIPE) onPastChange((pastIdx - 1 + past.length) % past.length)
          pastSwipeX.current = null
        }}
      >
        <div className="stat-panel-label">{t('pastLabel')}</div>
        <div className="stat-panel-count">
          {t('milestoneCount', { count: past.length })}
        </div>
        <NavRow idx={pastIdx} total={past.length} onChange={onPastChange} align="left" flip />
        {past[pastIdx] && <StatMilestone m={past[pastIdx]} align="left" />}
      </div>}

      {/* Right — future */}
      {showFuture && <div className="stat-panel stat-panel-right"
        onTouchStart={e => { futureSwipeX.current = e.touches[0].clientX }}
        onTouchEnd={e => {
          if (futureSwipeX.current === null || future.length <= 1) return
          const dx = e.changedTouches[0].clientX - futureSwipeX.current
          if      (dx < -SWIPE) onFutureChange((futureIdx + 1) % future.length)
          else if (dx >  SWIPE) onFutureChange((futureIdx - 1 + future.length) % future.length)
          futureSwipeX.current = null
        }}
      >
        <div className="stat-panel-label">{t('futureLabel')}</div>
        <div className="stat-panel-count">
          {t('milestoneCount', { count: future.length })}
        </div>
        <NavRow idx={futureIdx} total={future.length} onChange={onFutureChange} align="right" />
        {future[futureIdx] && <StatMilestone m={future[futureIdx]} align="right" />}
      </div>}
    </div>
  )
}
