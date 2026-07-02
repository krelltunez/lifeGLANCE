import { describe, it, expect } from 'vitest'
import { applyRecurFilter, computePinchZoom, PINCH_MIN_HALF_MS, PINCH_MAX_HALF_MS } from './timeline'

// Helper to build a minimal milestone-like object
function ms(id, dateStr, recurrence_id = null) {
  return { id, date: dateStr, recurrence_id }
}

// Dates relative to test run: use far-past and far-future to avoid flakiness
const PAST1   = '2000-01-01'
const PAST2   = '2001-06-15'
const FUTURE1 = '2099-01-01'
const FUTURE2 = '2099-06-15'
const RID_A   = 'rid-a'
const RID_B   = 'rid-b'

// Fixture set
//   non-recurring: n1 (past), n2 (future)
//   series A:      a1 (past), a2 (future)
//   series B:      b1 (past), b2 (past) — both past, no upcoming
const n1 = ms('n1', PAST1)
const n2 = ms('n2', FUTURE1)
const a1 = ms('a1', PAST2,   RID_A)
const a2 = ms('a2', FUTURE2, RID_A)
const b1 = ms('b1', PAST1,   RID_B)
const b2 = ms('b2', PAST2,   RID_B)

const ALL = [n1, n2, a1, a2, b1, b2]

describe('applyRecurFilter', () => {
  it('all — returns the full set unchanged', () => {
    const result = applyRecurFilter(ALL, 'all')
    expect(result).toHaveLength(ALL.length)
    expect(result).toEqual(expect.arrayContaining(ALL))
  })

  it('past — keeps non-recurring and only past recurring instances', () => {
    const result = applyRecurFilter(ALL, 'past')
    expect(result).toContain(n1)
    expect(result).toContain(n2)   // non-recurring are always included
    expect(result).toContain(a1)   // past recurring ✓
    expect(result).not.toContain(a2) // future recurring ✗
    expect(result).toContain(b1)
    expect(result).toContain(b2)
  })

  it('future — keeps non-recurring and only future recurring instances', () => {
    const result = applyRecurFilter(ALL, 'future')
    expect(result).toContain(n1)
    expect(result).toContain(n2)
    expect(result).not.toContain(a1) // past recurring ✗
    expect(result).toContain(a2)     // future recurring ✓
    expect(result).not.toContain(b1) // both b's are past
    expect(result).not.toContain(b2)
  })

  it('next — picks nearest upcoming per series, falls back to most recent past', () => {
    const result = applyRecurFilter(ALL, 'next')
    expect(result).toContain(n1)
    expect(result).toContain(n2)
    // Series A has a future instance → picks a2 (nearest upcoming)
    expect(result).toContain(a2)
    expect(result).not.toContain(a1)
    // Series B has no future instances → picks b2 (most recent past)
    expect(result).toContain(b2)
    expect(result).not.toContain(b1)
  })

  it('next — with only future instances picks the nearest one', () => {
    const rid = 'rid-future'
    const near = ms('near', FUTURE1, rid)
    const far  = ms('far',  FUTURE2, rid)
    const result = applyRecurFilter([near, far], 'next')
    expect(result).toContain(near)
    expect(result).not.toContain(far)
  })

  it('handles empty input', () => {
    expect(applyRecurFilter([], 'all')).toEqual([])
    expect(applyRecurFilter([], 'past')).toEqual([])
    expect(applyRecurFilter([], 'future')).toEqual([])
    expect(applyRecurFilter([], 'next')).toEqual([])
  })

  it('all — returns milestones with no recurrence_id unchanged', () => {
    const plain = [n1, n2]
    const result = applyRecurFilter(plain, 'all')
    expect(result).toEqual(plain)
  })
})

describe('computePinchZoom', () => {
  // Mirror of how the timeline maps a screen x to a timestamp, used to assert
  // the point under the pinch midpoint stays fixed.
  const timeUnderMid = (panMs, halfMs, midX, width, fraction = 0.5) =>
    panMs + (halfMs * 2) * (midX / width - fraction)

  // Geometry tests use a wide-open clamp so the finger math is exercised without
  // the real min/max flooring the small synthetic spans.
  const NOCLAMP = { minHalfMs: 0, maxHalfMs: Infinity }
  const base = { startHalfMs: 1000, startPanMs: 0, width: 1000, startMidX: 500, midX: 500, ...NOCLAMP }

  it('halves the span when fingers spread 2×; a centered pinch keeps pan', () => {
    const r = computePinchZoom({ ...base, distRatio: 2 })
    expect(r.halfMs).toBe(500)
    expect(r.panMs).toBe(0)
  })

  it('doubles the span when fingers pinch to half distance', () => {
    const r = computePinchZoom({ ...base, distRatio: 0.5 })
    expect(r.halfMs).toBe(2000)
  })

  it('clamps zoom-in to the min half-span', () => {
    const r = computePinchZoom({ startHalfMs: PINCH_MIN_HALF_MS, startPanMs: 0, width: 1000, startMidX: 500, midX: 500, distRatio: 1000 })
    expect(r.halfMs).toBe(PINCH_MIN_HALF_MS)
  })

  it('clamps zoom-out to the max half-span', () => {
    const r = computePinchZoom({ startHalfMs: PINCH_MAX_HALF_MS, startPanMs: 0, width: 1000, startMidX: 500, midX: 500, distRatio: 0.001 })
    expect(r.halfMs).toBe(PINCH_MAX_HALF_MS)
  })

  it('keeps the timestamp under an off-center pinch midpoint fixed', () => {
    const args = { ...base, startMidX: 750, midX: 750, distRatio: 2 }
    const before = timeUnderMid(args.startPanMs, args.startHalfMs, args.startMidX, args.width)
    const r = computePinchZoom(args)
    const after = timeUnderMid(r.panMs, r.halfMs, args.midX, args.width)
    expect(after).toBeCloseTo(before, 3)
  })

  it('pans when the two-finger midpoint translates without changing distance', () => {
    const r = computePinchZoom({ ...base, midX: 600, distRatio: 1 })
    expect(r.halfMs).toBe(1000)   // distance unchanged → no zoom
    expect(r.panMs).not.toBe(0)   // midpoint moved → view pans
  })

  it('honors a non-default view anchor (past) when preserving the midpoint', () => {
    const args = { startHalfMs: 1000, startPanMs: 12345, viewMode: 'past', width: 1000, startMidX: 300, midX: 300, distRatio: 1.5, ...NOCLAMP }
    const before = timeUnderMid(args.startPanMs, args.startHalfMs, args.startMidX, args.width, 0.88)
    const r = computePinchZoom(args)
    const after = timeUnderMid(r.panMs, r.halfMs, args.midX, args.width, 0.88)
    expect(after).toBeCloseTo(before, 3)
  })
})
