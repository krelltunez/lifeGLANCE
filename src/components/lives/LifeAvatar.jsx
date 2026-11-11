import React from 'react'
import { useLifePhotoUrl } from './lifePhoto'
import { lifeColor } from './lifeLabels'

// A Life's photo in a small circle ringed in its colour, or its colour dot when
// it has no photo (or the photo is not on this device and cannot be fetched).
export default function LifeAvatar({ life, size = '0.55rem', className = '' }) {
  const url = useLifePhotoUrl(life)
  if (!url) return <span className={`life-dot ${className}`} style={{ '--life-color': lifeColor(life), width: size, height: size }} aria-hidden="true" />
  return (
    <img
      src={url}
      alt=""
      className={`life-avatar ${className}`}
      style={{ '--life-color': lifeColor(life), width: size, height: size }}
    />
  )
}
