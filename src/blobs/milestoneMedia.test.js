// Tests for the Phase 8.1 milestone↔blob wiring. Pure unit tests with injected
// fakes (the real native upload + canvas thumbnail run on-device only — the
// Phase 7 modules are already structured for exactly this fake-deps testing).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isRealBlobHash,
  uploadMilestoneMedia,
  releaseMilestoneMedia,
  fetchThumbnailBytes,
  fetchFullResBytes,
  clearThumbnailCache,
} from './milestoneMedia.js'

const HASH_A = 'a'.repeat(64) // full-res
const HASH_T = 'b'.repeat(64) // thumbnail
const bytes = new Uint8Array([1, 2, 3])

beforeEach(() => clearThumbnailCache())

describe('isRealBlobHash — real hash vs legacy placeholder', () => {
  it('accepts a 64-hex sha256', () => expect(isRealBlobHash('f'.repeat(64))).toBe(true))
  it('rejects the deterministic placeholders and junk', () => {
    expect(isRealBlobHash('11111111-2222-4333-8444-555555555555')).toBe(false) // uuid
    expect(isRealBlobHash('11111111-2222-4333-8444-555555555555-photo')).toBe(false)
    expect(isRealBlobHash(null)).toBe(false)
    expect(isRealBlobHash('ABC')).toBe(false)
    expect(isRealBlobHash('g'.repeat(64))).toBe(false) // non-hex
  })
})

describe('uploadMilestoneMedia — ordering + clean-fail', () => {
  function recorder(overrides = {}) {
    const calls = []
    return {
      calls,
      generateThumbnail: overrides.generateThumbnail ?? (async () => { calls.push('thumb'); return { bytes: new Uint8Array([9]), mimeType: 'image/jpeg' } }),
      uploadBlob: overrides.uploadBlob ?? (async (b) => { calls.push(`upload:${b[0]}`); return b[0] === 9 ? HASH_T : HASH_A }),
      addBlobRef: overrides.addBlobRef ?? (async (h) => { calls.push(`ref:${h === HASH_T ? 'T' : 'A'}`) }),
    }
  }

  it('image: generates thumbnail, uploads full THEN thumb, refs both — in order, before returning slots', async () => {
    const d = recorder()
    const out = await uploadMilestoneMedia({ bytes, mimeType: 'image/png' }, d)
    expect(out).toEqual({ fullHash: HASH_A, thumbHash: HASH_T })
    // thumbnail made first, then both uploads, then both refs — references last.
    expect(d.calls).toEqual(['thumb', 'upload:1', 'upload:9', 'ref:A', 'ref:T'])
  })

  it('video: same path (poster thumbnail)', async () => {
    const d = recorder()
    const out = await uploadMilestoneMedia({ bytes, mimeType: 'video/mp4' }, d)
    expect(out).toEqual({ fullHash: HASH_A, thumbHash: HASH_T })
    expect(d.calls).toEqual(['thumb', 'upload:1', 'upload:9', 'ref:A', 'ref:T'])
  })

  it('audio: no thumbnail — one upload, one ref, thumbHash null', async () => {
    const d = recorder()
    const out = await uploadMilestoneMedia({ bytes, mimeType: 'audio/webm' }, d)
    expect(out).toEqual({ fullHash: HASH_A, thumbHash: null })
    expect(d.calls).toEqual(['upload:1', 'ref:A']) // no 'thumb'
  })

  it('thumbnail-generation failure aborts BEFORE any upload or ref (no reference to a thumbnail that was never made)', async () => {
    const err = new Error('corrupt source')
    const d = recorder({ generateThumbnail: async () => { throw err } })
    await expect(uploadMilestoneMedia({ bytes, mimeType: 'image/png' }, d)).rejects.toThrow('corrupt source')
    expect(d.calls).toEqual([]) // nothing uploaded, nothing referenced
  })

  it('upload failure throws and never reaches ref-add (no half-written reference)', async () => {
    const calls = []
    const d = {
      generateThumbnail: async () => { calls.push('thumb'); return { bytes: new Uint8Array([9]), mimeType: 'image/jpeg' } },
      uploadBlob: async (b) => { calls.push(`upload:${b[0]}`); if (b[0] === 9) throw new Error('upload failed') ; return HASH_A },
      addBlobRef: async () => { calls.push('ref') },
    }
    await expect(uploadMilestoneMedia({ bytes, mimeType: 'image/png' }, d)).rejects.toThrow('upload failed')
    // full uploaded, thumb upload threw → no ref-add at all
    expect(calls).toEqual(['thumb', 'upload:1', 'upload:9'])
  })
})

describe('releaseMilestoneMedia — delete path', () => {
  it('releases each unique real-hash slot, ignores placeholders', async () => {
    const released = []
    const m = { photo_id: HASH_A, thumbnail_id: HASH_T, media_id: 'some-uuid-placeholder' }
    const out = await releaseMilestoneMedia(m, { releaseBlobRef: async (h) => { released.push(h) } })
    expect(released.sort()).toEqual([HASH_A, HASH_T].sort())
    expect(out.sort()).toEqual([HASH_A, HASH_T].sort())
  })

  it('dedups when full-res and thumbnail share a slot value', async () => {
    const released = []
    const m = { photo_id: HASH_A, thumbnail_id: HASH_A }
    await releaseMilestoneMedia(m, { releaseBlobRef: async (h) => { released.push(h) } })
    expect(released).toEqual([HASH_A]) // once
  })

  it('is best-effort: a failing release never throws (delete must not be blocked)', async () => {
    const m = { photo_id: HASH_A }
    await expect(
      releaseMilestoneMedia(m, { releaseBlobRef: async () => { throw new Error('network') } }),
    ).resolves.toEqual([HASH_A])
  })

  it('no-ops for a local-only milestone (no real-hash slots)', async () => {
    let called = false
    const m = { photo_id: 'uuid-photo', media_id: null, thumbnail_id: null }
    const out = await releaseMilestoneMedia(m, { releaseBlobRef: async () => { called = true } })
    expect(out).toEqual([])
    expect(called).toBe(false)
  })
})

describe('display fetch — cache + discrimination', () => {
  it('fetchThumbnailBytes downloads a real hash and caches it (no second download)', async () => {
    let downloads = 0
    const downloadBlob = async () => { downloads += 1; return new Uint8Array([7, 7]) }
    const a = await fetchThumbnailBytes(HASH_T, { downloadBlob })
    const b = await fetchThumbnailBytes(HASH_T, { downloadBlob })
    expect(a).toEqual(new Uint8Array([7, 7]))
    expect(b).toEqual(new Uint8Array([7, 7]))
    expect(downloads).toBe(1) // cached
  })

  it('fetchThumbnailBytes returns null for a placeholder slot (no fetch)', async () => {
    let called = false
    const r = await fetchThumbnailBytes('uuid-photo', { downloadBlob: async () => { called = true } })
    expect(r).toBeNull()
    expect(called).toBe(false)
  })

  it('fetchThumbnailBytes does NOT cache a failure (re-fetch allows self-heal)', async () => {
    let n = 0
    const downloadBlob = async () => { n += 1; if (n === 1) throw new Error('missing'); return new Uint8Array([5]) }
    await expect(fetchThumbnailBytes(HASH_T, { downloadBlob })).rejects.toThrow('missing')
    const second = await fetchThumbnailBytes(HASH_T, { downloadBlob })
    expect(second).toEqual(new Uint8Array([5]))
    expect(n).toBe(2)
  })

  it('fetchFullResBytes downloads a real hash, null for placeholder', async () => {
    const downloadBlob = vi.fn(async () => new Uint8Array([1]))
    expect(await fetchFullResBytes(HASH_A, { downloadBlob })).toEqual(new Uint8Array([1]))
    expect(await fetchFullResBytes('uuid', { downloadBlob })).toBeNull()
    expect(downloadBlob).toHaveBeenCalledTimes(1)
  })
})
