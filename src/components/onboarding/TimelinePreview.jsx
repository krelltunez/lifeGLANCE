import React from 'react'
import { useTranslation } from 'react-i18next'
import { dateToX, getTimeRange } from '../../utils/timeline'

const HEIGHT = 72
const AXIS_Y = 36

export default function TimelinePreview({ milestones = [] }) {
  const { t } = useTranslation('timeline')
  const [width, setWidth] = React.useState(600)
  const ref = React.useRef(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const today  = new Date()
  const { startMs, endMs } = getTimeRange('years', today.getTime())
  const todayX = dateToX(today.getTime(), startMs, endMs, width)

  return (
    <div className="timeline-preview" ref={ref}>
      <svg width={width} height={HEIGHT} style={{ display: 'block', fontSize: '1rem' }}>
        <defs>
          <linearGradient id="prev-left"  x1="0" x2="1" y1="0" y2="0">
            <stop offset="0"   stopColor="var(--bg)" stopOpacity="1" />
            <stop offset="1"   stopColor="var(--bg)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="prev-right" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0"   stopColor="var(--bg)" stopOpacity="0" />
            <stop offset="1"   stopColor="var(--bg)" stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* Axis */}
        <line
          x1={0} y1={AXIS_Y} x2={width} y2={AXIS_Y}
          stroke="rgba(var(--text-rgb), 0.12)" strokeWidth={1}
        />

        {/* Today marker */}
        <line
          x1={todayX} y1={8} x2={todayX} y2={HEIGHT - 8}
          stroke="var(--amber)" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.7}
        />
        <text
          x={todayX} y={6}
          textAnchor="middle"
          fill="var(--amber)"
          fontSize="0.5em"
          fontFamily="'Courier Prime', monospace"
          opacity={0.7}
        >
          {t('today')}
        </text>

        {/* Milestone dots */}
        {milestones.map((m, i) => {
          const x = dateToX(new Date(m.date).getTime(), startMs, endMs, width)
          if (x < 4 || x > width - 4) return null
          const above = i % 2 === 0
          const y = above ? AXIS_Y - 16 : AXIS_Y + 16

          return (
            <g key={m.id} style={{ animation: 'milestone-appear 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards' }}>
              <line
                x1={x} y1={AXIS_Y}
                x2={x} y2={above ? y + 4 : y - 4}
                stroke={m.color} strokeWidth={1} opacity={0.5}
              />
              <circle cx={x} cy={y} r={4} fill={m.color} />
              <text
                x={x} y={above ? y - 7 : y + 13}
                textAnchor="middle"
                fill="rgba(var(--text-rgb), 0.7)"
                fontSize="0.44em"
                fontFamily="'Courier Prime', monospace"
              >
                {m.title.length > 14 ? m.title.slice(0, 14) + '…' : m.title}
              </text>
            </g>
          )
        })}

        {/* Edge fades */}
        <rect x={0}        y={0} width={50}  height={HEIGHT} fill="url(#prev-left)"  pointerEvents="none" />
        <rect x={width-50} y={0} width={50}  height={HEIGHT} fill="url(#prev-right)" pointerEvents="none" />
      </svg>
    </div>
  )
}
