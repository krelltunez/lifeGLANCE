import { describe, it, expect } from 'vitest'
import { mergePayloads } from './adapter'

// Regression coverage for the birthday last-writer-wins merge. An empty remote
// birthday must never clobber a real local one — the common trigger is legacy
// rows where neither side has a birthdayUpdatedAt (ts 0/0).

const payload = (life) => ({ lives: { default: { milestones: [], chapters: [], ...life } } })
const birthdayOf = (local, remote) =>
  mergePayloads(payload(local), payload(remote)).data.lives.default.birthday
const categoriesOf = (local, remote) =>
  mergePayloads(payload(local), payload(remote)).data.lives.default.categories

describe('mergePayloads birthday LWW', () => {
  it('keeps a real local birthday when the remote is empty and neither is timestamped', () => {
    expect(birthdayOf({ birthday: '1990-05-01' }, { birthday: '' })).toBe('1990-05-01')
  })

  it('keeps a real local birthday when remote is empty at an equal timestamp', () => {
    const ts = '2026-01-01T00:00:00.000Z'
    expect(birthdayOf(
      { birthday: '1990-05-01', birthdayUpdatedAt: ts },
      { birthday: '', birthdayUpdatedAt: ts },
    )).toBe('1990-05-01')
  })

  it('accepts a real remote birthday when the local side is empty', () => {
    expect(birthdayOf({ birthday: '' }, { birthday: '1988-02-02' })).toBe('1988-02-02')
  })

  it('lets a strictly-newer remote win, including an intentional clear', () => {
    expect(birthdayOf(
      { birthday: '1990-05-01', birthdayUpdatedAt: '2026-01-01T00:00:00.000Z' },
      { birthday: '', birthdayUpdatedAt: '2026-06-01T00:00:00.000Z' },
    )).toBe('')
  })

  it('lets a strictly-newer remote value win over an older local one', () => {
    expect(birthdayOf(
      { birthday: '1990-05-01', birthdayUpdatedAt: '2026-01-01T00:00:00.000Z' },
      { birthday: '1991-07-07', birthdayUpdatedAt: '2026-06-01T00:00:00.000Z' },
    )).toBe('1991-07-07')
  })

  it('keeps a newer local birthday against an older remote', () => {
    expect(birthdayOf(
      { birthday: '1990-05-01', birthdayUpdatedAt: '2026-06-01T00:00:00.000Z' },
      { birthday: '1991-07-07', birthdayUpdatedAt: '2026-01-01T00:00:00.000Z' },
    )).toBe('1990-05-01')
  })
})

describe('mergePayloads categories LWW', () => {
  const cats = (...names) => names.map((n) => ({ id: n, name: n }))

  it('keeps a real local category list when remote is empty and neither is timestamped', () => {
    expect(categoriesOf({ categories: cats('work', 'family') }, { categories: [] }))
      .toEqual(cats('work', 'family'))
  })

  it('keeps a real local list when remote is empty at an equal timestamp', () => {
    const ts = '2026-01-01T00:00:00.000Z'
    expect(categoriesOf(
      { categories: cats('work'), categoriesUpdatedAt: ts },
      { categories: [], categoriesUpdatedAt: ts },
    )).toEqual(cats('work'))
  })

  it('accepts a real remote list when the local side is empty', () => {
    expect(categoriesOf({ categories: [] }, { categories: cats('travel') }))
      .toEqual(cats('travel'))
  })

  it('lets a strictly-newer remote win, including clearing all categories', () => {
    expect(categoriesOf(
      { categories: cats('work'), categoriesUpdatedAt: '2026-01-01T00:00:00.000Z' },
      { categories: [], categoriesUpdatedAt: '2026-06-01T00:00:00.000Z' },
    )).toEqual([])
  })
})
