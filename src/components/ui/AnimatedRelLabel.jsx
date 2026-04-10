import React, { useRef, useEffect, useState } from 'react'
import { getYearsMonths } from '../../utils/dates'

const DUR = 420 // ms for count-up animation

/**
 * Animates a single integer from its previous value to `value`
 * using a rAF ease-out-cubic loop.  On first mount it counts from 0.
 */
function AnimatedNumber({ value }) {
  const [disp,    setDisp]  = useState(0)
  const prevRef  = useRef(null)
  const rafRef   = useRef(null)

  useEffect(() => {
    const from = prevRef.current === null ? 0 : prevRef.current
    prevRef.current = value
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (from === value) { setDisp(value); return }

    const t0 = performance.now()
    const tick = (ts) => {
      const p = Math.min((ts - t0) / DUR, 1)
      const e = 1 - (1 - p) ** 3          // ease-out cubic
      setDisp(Math.round(from + (value - from) * e))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [value])

  return <>{disp}</>
}

/**
 * Renders the relative-time label for a milestone date with animated numbers.
 * Mirrors the logic of relativeLabel() so format matches exactly.
 */
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
