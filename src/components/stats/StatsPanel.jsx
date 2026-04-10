import React, { useRef } from 'react'
import { formatDateDisplay } from '../../utils/dates'
import TypewriterText from '../ui/TypewriterText'
import AnimatedRelLabel from '../ui/AnimatedRelLabel'

function StatMilestone({ m, align }) {
  const dateStr = formatDateDisplay(m.date, m.date_precision)
  const k = m.id + (m.updated_at || '')

  return (
    <div className={`stat-milestone ${align === 'right' ? 'stat-milestone-right' : ''}`}>
      <div className="stat-milestone-title">
        <TypewriterText key={k + 'title'} text={m.title}
          options={{ delay: 18, jitter: 10 }} showCursor={false} />
      </div>
      <div className="stat-milestone-date">
        <TypewriterText key={k + 'date'} text={dateStr}
          options={{ delay: 14, jitter: 6, startDelay: 180 }} showCursor={false} />
      </div>
      <div className="stat-milestone-rel">
        <AnimatedRelLabel dateStr={m.date} />
      </div>
    </div>
  )
}

// flip=true for past panel: ← goes to higher idx (older), → goes to lower idx (more recent)
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

export default function StatsPanel({ past, future, pastIdx, futureIdx, onPastChange, onFutureChange }) {
  const pastSwipeX   = useRef(null)
  const futureSwipeX = useRef(null)
  const SWIPE = 40 // min px to register a swipe

  return (
    <div className="stat-panels">
      {/* Left — past */}
      <div className="stat-panel"
        onTouchStart={e => { pastSwipeX.current = e.touches[0].clientX }}
        onTouchEnd={e => {
          if (pastSwipeX.current === null || past.length <= 1) return
          const dx = e.changedTouches[0].clientX - pastSwipeX.current
          // swipe left = older (higher idx); swipe right = more recent (lower idx)
          if      (dx < -SWIPE) onPastChange((pastIdx + 1) % past.length)
          else if (dx >  SWIPE) onPastChange((pastIdx - 1 + past.length) % past.length)
          pastSwipeX.current = null
        }}
      >
        <div className="stat-panel-label">← past</div>
        <div className="stat-panel-count">
          {past.length} milestone{past.length !== 1 ? 's' : ''}
        </div>
        <NavRow idx={pastIdx} total={past.length} onChange={onPastChange} align="left" flip />
        {past[pastIdx] && <StatMilestone m={past[pastIdx]} align="left" />}
      </div>

      {/* Right — future */}
      <div className="stat-panel stat-panel-right"
        onTouchStart={e => { futureSwipeX.current = e.touches[0].clientX }}
        onTouchEnd={e => {
          if (futureSwipeX.current === null || future.length <= 1) return
          const dx = e.changedTouches[0].clientX - futureSwipeX.current
          // swipe left = further future (higher idx); swipe right = nearer (lower idx)
          if      (dx < -SWIPE) onFutureChange((futureIdx + 1) % future.length)
          else if (dx >  SWIPE) onFutureChange((futureIdx - 1 + future.length) % future.length)
          futureSwipeX.current = null
        }}
      >
        <div className="stat-panel-label">future →</div>
        <div className="stat-panel-count">
          {future.length} milestone{future.length !== 1 ? 's' : ''}
        </div>
        <NavRow idx={futureIdx} total={future.length} onChange={onFutureChange} align="right" />
        {future[futureIdx] && <StatMilestone m={future[futureIdx]} align="right" />}
      </div>
    </div>
  )
}
