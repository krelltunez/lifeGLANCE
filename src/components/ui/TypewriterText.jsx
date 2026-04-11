import React from 'react'
import { useTypewriter } from '../../utils/typewriter'
import { playKeyClick } from '../../utils/audio'

/**
 * Renders text with a typewriter effect.
 * `showCursor` keeps the blinking cursor visible after typing completes.
 * `hideCursorWhenDone` hides the cursor once typing finishes.
 * `playSound` fires a soft key-click for each character typed.
 */
export default function TypewriterText({
  text,
  className,
  options      = {},
  showCursor   = true,
  hideCursorWhenDone = false,
  onDone,
  playSound = false,
}) {
  const { displayed, done } = useTypewriter(text, options)
  const prevLenRef = React.useRef(0)

  React.useEffect(() => {
    if (done && onDone) onDone()
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (playSound && displayed.length > prevLenRef.current) {
      playKeyClick()
    }
    prevLenRef.current = displayed.length
  }, [displayed]) // eslint-disable-line react-hooks/exhaustive-deps

  const cursorVisible = showCursor && !(hideCursorWhenDone && done)

  return (
    <span className={className}>
      {displayed}
      {cursorVisible && <span className="cursor" />}
    </span>
  )
}
