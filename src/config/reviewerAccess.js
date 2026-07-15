// Reviewer bypass secret for the Play (and later App Store) hard gate.
//
// Store review must have a way past the paywall (Play App-access policy /
// Apple Guideline 2.1). The code shown to reviewers is HMAC(secret, "YYYY-MM")
// truncated to 12 hex chars, so it rotates on the 1st of each month — run
// `npm run reviewer-code` to print the current (and a future) month's code.
//
// This secret is deliberately COMMITTED, not injected via env: the running app
// and the CLI both import this one module, so they can never disagree, and the
// secret is never typed on a command line. The split concatenation is light
// obfuscation against casual greps only — the bypass is honor-system by design
// (the GitHub sideload and web builds are fully unlocked anyway).
//
// lifeGLANCE-specific: distinct from lastGLANCE's and dayGLANCE's secrets so a
// leaked code unlocks only this app. Do NOT change it once a build carrying it
// has been submitted for review — that would invalidate the codes already in
// the review notes.
import { deriveReviewerCode as derive } from '@glance-apps/billing'

const _S = 'lifeg-r3v13w-' + '25742c2663ddaa9d6dd08e7c'

export const REVIEWER_SECRET = _S

// Derives the reviewer code for the given "YYYY-MM" period (default: current
// UTC month) from this app's secret. Thin wrapper so callers never handle the
// secret directly.
export function deriveReviewerCode(period) {
  return derive(_S, period)
}
