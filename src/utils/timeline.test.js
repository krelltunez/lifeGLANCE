import { describe, it, expect } from 'vitest'
import { applyRecurFilter, assignLanes, computePinchZoom, PINCH_MIN_HALF_MS, PINCH_MAX_HALF_MS } from './timeline'

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


describe('applyRecurFilter with an injected now', () => {
  // A yearly series straddling the injected date; the real clock must not matter.
  const y25 = ms('y25', '2025-09-01T00:00:00Z', 'yearly')
  const y26 = ms('y26', '2026-09-01T00:00:00Z', 'yearly')
  const y27 = ms('y27', '2027-09-01T00:00:00Z', 'yearly')
  const series = [y25, y26, y27]
  const JUNE_2026 = new Date('2026-06-20T12:00:00Z')
  const OCT_2026 = new Date('2026-10-11T12:00:00Z')

  it("'next' picks the nearest instance on or after the given now", () => {
    expect(applyRecurFilter(series, 'next', JUNE_2026).map(m => m.id)).toEqual(['y26'])
    expect(applyRecurFilter(series, 'next', OCT_2026).map(m => m.id)).toEqual(['y27'])
  })

  it("'past' and 'future' split on the given now", () => {
    expect(applyRecurFilter(series, 'past', JUNE_2026).map(m => m.id)).toEqual(['y25'])
    expect(applyRecurFilter(series, 'future', JUNE_2026).map(m => m.id)).toEqual(['y26', 'y27'])
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

describe('assignLanes lane separation', () => {
  const YR  = 365.25 * 24 * 3600 * 1000
  const DAY = 24 * 3600 * 1000

  // Two cards may share a lane only if they are at least one card width apart.
  function conflicts(laned, cardTimeSpan) {
    const bad = []
    for (let i = 0; i < laned.length; i++) {
      for (let j = i + 1; j < laned.length; j++) {
        const a = laned[i], b = laned[j]
        if (a.above !== b.above || a.lane !== b.lane) continue
        if (Math.abs(new Date(a.date) - new Date(b.date)) < cardTimeSpan)
          bad.push([a.id, b.id])
      }
    }
    return bad
  }

  // A dozen milestones over ~14 years on a tablet-width timeline. This is
  // sparse enough to take the force-directed path (avg neighbours < 3), which
  // on its own rounds neighbouring cards into the same lane and leaves a lane
  // unused. Regression guard for the store-screenshot tablet frames.
  const sparseButColliding = [
    ms('a', '2017-10-07'), ms('b', '2019-05-06'), ms('c', '2020-09-06'),
    ms('d', '2020-11-01'), ms('e', '2021-11-01'), ms('f', '2022-08-08'),
    ms('g', '2024-01-24'), ms('h', '2025-02-23'), ms('i', '2026-12-05'),
    ms('j', '2027-06-21'), ms('k', '2027-10-21'), ms('l', '2029-02-21'),
    ms('m', '2029-04-23'), ms('n', '2030-04-02'),
  ]

  it('never leaves two cards overlapping in the same lane', () => {
    // 148px card on a 1529px timeline spanning 14 years
    const cardTimeSpan = (14 * YR / 1529) * 148
    const laned = assignLanes(sparseButColliding, 3, cardTimeSpan, true)
    expect(laned).toHaveLength(sparseButColliding.length)
    expect(conflicts(laned, cardTimeSpan)).toEqual([])
  })

  it('holds across a range of widths and spans', () => {
    for (const width of [1529, 1800, 2200]) {
      for (const spanYears of [10, 12, 14, 16, 20]) {
        const cardTimeSpan = (spanYears * YR / width) * 148
        const laned = assignLanes(sparseButColliding, 3, cardTimeSpan, true)
        expect(conflicts(laned, cardTimeSpan), `${width}px / ${spanYears}y`).toEqual([])
      }
    }
  })

  it('still packs cards that cannot be separated into the lanes available', () => {
    // Five milestones inside one card width against four lanes: the fifth has
    // nowhere to go, so a conflict is expected rather than an exception.
    const crowd = [0, 1, 2, 3, 4].map(i => ms(`c${i}`, new Date(Date.UTC(2026, 0, 1 + i * 10)).toISOString()))
    const laned = assignLanes(crowd, 3, 365 * DAY, true)
    expect(laned).toHaveLength(5)
    expect(new Set(laned.map(m => m.lane)).size).toBe(4) // all four lanes used
  })

  it('keeps every milestone and assigns a lane within range', () => {
    const cardTimeSpan = (14 * YR / 1529) * 148
    const laned = assignLanes(sparseButColliding, 3, cardTimeSpan, true)
    expect(laned.map(m => m.id).sort()).toEqual(sparseButColliding.map(m => m.id).sort())
    for (const m of laned) {
      expect(m.lane).toBeGreaterThanOrEqual(0)
      expect(m.lane).toBeLessThanOrEqual(3)
      expect(m.above).toBe(true)
    }
  })
})
