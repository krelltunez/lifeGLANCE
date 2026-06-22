import React from 'react'
import { Trans } from 'react-i18next'
import { useCountUp } from '../../utils/typewriter'
import { relativeParts } from '../../utils/dates'

/**
 * Renders the relative-time label for a milestone with numbers that
 * count up from 0 when the component mounts. Shares the relativeParts()
 * shape logic with relativeLabel(); the localized strings wrap each number
 * in a positional component tag (<0/>, <1/>) which maps to an animated number.
 */
function AnimatedNumber({ value }) {
  const disp = useCountUp(value, { duration: 420, active: true })
  return <>{disp}</>
}

export default function AnimatedRelLabel({ dateStr }) {
  const { key, today, count = 0, months = 0 } = relativeParts(dateStr)

  if (today) return <Trans i18nKey="relToday" ns="common" />

  return (
    <Trans
      i18nKey={key}
      ns="common"
      count={count}
      values={{ count, months }}
      components={[
        <AnimatedNumber value={count} />,
        <AnimatedNumber value={months} />,
      ]}
    />
  )
}
