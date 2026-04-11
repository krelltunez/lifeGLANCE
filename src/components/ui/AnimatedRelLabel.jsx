import React from 'react'
import { useCountUp } from '../../utils/typewriter'
import { getYearsMonths } from '../../utils/dates'

/**
 * Renders the relative-time label for a milestone with numbers that
 * count up from 0 when the component mounts.
 * Mirrors the format logic of relativeLabel() exactly.
 */
function AnimatedNumber({ value }) {
  const disp = useCountUp(value, { duration: 420, active: true })
  return <>{disp}</>
}

export default function AnimatedRelLabel({ dateStr }) {
  const { years, months, days, past } = getYearsMonths(dateStr)

  if (years > 0 && months > 0) {
    const ys = years !== 1 ? 's' : ''
    return past
      ? <><AnimatedNumber value={years} /> yr{ys}, <AnimatedNumber value={months} /> mo ago</>
      : <>in <AnimatedNumber value={years} /> yr{ys}, <AnimatedNumber value={months} /> mo</>
  }
  if (years > 0) {
    const ys = years !== 1 ? 's' : ''
    return past
      ? <><AnimatedNumber value={years} /> yr{ys} ago</>
      : <>in <AnimatedNumber value={years} /> yr{ys}</>
  }
  if (days > 30) {
    const mo = Math.floor(days / 30)
    return past
      ? <><AnimatedNumber value={mo} /> mo ago</>
      : <>in <AnimatedNumber value={mo} /> mo</>
  }
  if (days > 0) {
    const ds = days !== 1 ? 's' : ''
    return past
      ? <><AnimatedNumber value={days} /> day{ds} ago</>
      : <>in <AnimatedNumber value={days} /> day{ds}</>
  }
  return <>today</>
}
