import React from 'react'
import { formatDateDisplay, relativeLabel } from '../../utils/dates'
import TypewriterText from '../ui/TypewriterText'

function StatMilestone({ m, align }) {
  const dateStr = formatDateDisplay(m.date, m.date_precision)
  const relStr  = relativeLabel(m.date, m.date_precision)
  // key includes updated_at so edits re-trigger the typewriter
  const k = m.id + (m.updated_at || '')

  return (
    <div className={`stat-milestone ${align === 'right' ? 'stat-milestone-right' : ''}`}>
      <div className="stat-milestone-title">
        <TypewriterText
          key={k + 'title'}
          text={m.title}
          options={{ delay: 18, jitter: 10 }}
          showCursor={false}
        />
      </div>
      <div className="stat-milestone-date">
        <TypewriterText
          key={k + 'date'}
          text={dateStr}
          options={{ delay: 14, jitter: 6, startDelay: 180 }}
          showCursor={false}
        />
      </div>
      <div className="stat-milestone-rel">
        <TypewriterText
          key={k + 'rel'}
          text={relStr}
          options={{ delay: 14, jitter: 6, startDelay: 320 }}
          showCursor={false}
        />
      </div>
    </div>
  )
}

export default function StatsPanel({ milestones }) {
  const now    = new Date()
  const past   = milestones.filter(m => new Date(m.date) < now)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
  const future = milestones.filter(m => new Date(m.date) >= now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  return (
    <div className="stat-panels">
      {/* Left — past */}
      <div className="stat-panel">
        <div className="stat-panel-label">← past</div>
        <div className="stat-panel-count">
          {past.length} milestone{past.length !== 1 ? 's' : ''}
        </div>
        {past[0] && <StatMilestone m={past[0]} align="left" />}
      </div>

      {/* Right — future */}
      <div className="stat-panel stat-panel-right">
        <div className="stat-panel-label">future →</div>
        <div className="stat-panel-count">
          {future.length} milestone{future.length !== 1 ? 's' : ''}
        </div>
        {future[0] && <StatMilestone m={future[0]} align="right" />}
      </div>
    </div>
  )
}
