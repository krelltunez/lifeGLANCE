import { describe, it, expect } from 'vitest'
import { deriveReviewerCode } from './reviewerAccess'

describe('reviewerAccess', () => {
  it('derives a 12-hex code for an explicit period', async () => {
    expect(await deriveReviewerCode('2026-09')).toMatch(/^[0-9a-f]{12}$/)
  })

  it('derives a code for the current month when no period is given', async () => {
    const period = new Date().toISOString().slice(0, 7)
    expect(await deriveReviewerCode()).toBe(await deriveReviewerCode(period))
  })

  // Pinned vector: fails if REVIEWER_SECRET ever changes. That is the point —
  // rotating the secret after a build reaches store review invalidates the
  // codes already in the review notes (docs/paywall-billing-plan.md Lesson 2).
  // Only update this vector if the secret is changed deliberately, before any
  // reviewed build carries it.
  it('matches the pinned vector for this app secret', async () => {
    expect(await deriveReviewerCode('2026-09')).toBe('d83faadb0d3b')
  })
})
