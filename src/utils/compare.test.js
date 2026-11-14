import { describe, it, expect } from 'vitest'
import { makeCompareAxis, lifeOffsetMs, compareRows, agesAt, placeLabels, chapterLanes } from './compare'

// Lives Phase 6a: the compare view's axis and rows. Source of truth:
// docs/lifeGLANCE-app-spec.md, "Compare / overlay view" and "Decided in Phase 6a".

const at = '2026-01-01T00:00:00.000Z'
const ops = (...ids) => Object.fromEntries(ids.map(id => [id, { op: 'add', at }]))
const ms = (id, date, extra = {}) => ({ id, title: id, date: `${date}T00:00:00.000Z`, category: 'family', ...extra })
const ME = { id: 'me', name: 'Me' }
const MOM = { id: 'mom', name: 'Mom', birthDate: '1960-03-04' }
const DAD = { id: 'dad', name: 'Dad', birthDate: '1955-01-01', deathDate: '2015-06-30' }
const birthDateOf = (l) => (l.id === 'me' ? '1990-05-06' : l.birthDate)
const NOW = Date.parse('2026-11-14T00:00:00Z')

describe('the axis', () => {
  it('is date-aligned: every Life has offset 0 and the same moment has the same x on every row', () => {
    const axis = makeCompareAxis({ startMs: 0, endMs: 1000, width: 100 })
    expect(axis.x(500, { life: ME })).toBe(50)
    expect(axis.x(500, { life: MOM })).toBe(axis.x(500, { life: ME }))
    expect(axis.msAt(50, { life: MOM })).toBe(500)
    expect(lifeOffsetMs({ life: MOM }, 'date')).toBe(0)
  })

  it('refuses an alignment it does not support yet', () => {
    expect(() => lifeOffsetMs({ life: MOM }, 'age')).toThrow(/Unsupported/)
  })
})

describe('rows', () => {
  const milestones = [
    ms('mine', '2012-06-01'),
    ms('hers', '1985-01-01', { lifeOps: ops('mom') }),
    ms('wedding', '1988-07-01', { lifeOps: ops('mom', 'dad') }),
    ms('memorial', '2016-06-30', { lifeOps: ops('dad') }),
  ]
  const chapters = [
    { id: 'house', title: 'Our house', start: '1980-01-01T00:00:00.000Z', end: null, milestoneIds: [], lifeOps: ops('mom', 'dad') },
    { id: 'school', title: 'School', start: '1996-09-01T00:00:00.000Z', end: '2008-06-01T00:00:00.000Z', milestoneIds: [] },
  ]
  const rows = (selectedIds, extra = {}) => compareRows({ lives: [ME, MOM, DAD], selectedIds, milestones, chapters, birthDateOf, nowMs: NOW, ...extra })

  it('one row per chosen Life, in the order of the Lives', () => {
    expect(rows(['dad', 'me']).map(r => r.life.id)).toEqual(['me', 'dad'])
  })

  it('a shared milestone and a shared chapter appear on every row they belong to', () => {
    const [mom, dad] = rows(['mom', 'dad'])
    expect(mom.milestones.map(m => m.id)).toEqual(['hers', 'wedding'])
    expect(dad.milestones.map(m => m.id)).toEqual(['wedding', 'memorial'])
    expect(mom.chapters.map(c => c.id)).toEqual(['house'])
    expect(dad.chapters.map(c => c.id)).toEqual(['house'])
  })

  it('a row runs from the birth date to the death date, or to now', () => {
    const [me, dad] = rows(['me', 'dad'])
    expect(me.fromMs).toBe(Date.parse('1990-05-06T00:00:00Z'))
    expect(me.toMs).toBe(NOW)
    expect(me.ended).toBe(false)
    expect(dad.toMs).toBe(Date.parse('2015-06-30T00:00:00Z'))
    expect(dad.ended).toBe(true)
  })

  it('without a birth date, a row starts at its earliest milestone or chapter', () => {
    const [me] = compareRows({ lives: [ME], selectedIds: ['me'], milestones, chapters, birthDateOf: () => null, nowMs: NOW })
    expect(me.fromMs).toBe(Date.parse('1996-09-01T00:00:00Z'))
  })

  it('ongoing chapters end at the death date; a milestone after the death is kept', () => {
    const [, dad] = rows(['me', 'dad'])
    expect(dad.chapters[0].end).toBe('2015-06-30T00:00:00.000Z')
    expect(dad.milestones.map(m => m.id)).toContain('memorial')
    const [mom] = rows(['mom'])
    expect(mom.chapters[0].end).toBeNull()   // Mom is alive: still ongoing
  })

  it('follows the category filter for chapters and the visibility cascade per Life', () => {
    const tagged = [{ ...chapters[0], category: 'home' }]
    expect(rows(['mom'], { chapters: tagged, categoryFilter: new Set(['family']) })[0].chapters).toEqual([])
    const hidden = [...milestones, ms('secret', '1990-01-01', { lifeOps: ops('mom'), mainTimelineVisibility: 'hidden' })]
    expect(rows(['mom'], { milestones: hidden })[0].milestones.map(m => m.id)).not.toContain('secret')
  })
})

describe('ages on a date', () => {
  it("gives each row's age, or says not born, after the death, or no birth date", () => {
    const rows = [
      { life: ME, birthDate: '1990-05-06', deathDate: null },
      { life: MOM, birthDate: '1960-03-04', deathDate: null },
      { life: DAD, birthDate: '1955-01-01', deathDate: '2015-06-30' },
      { life: { id: 'x' }, birthDate: null, deathDate: null },
    ]
    const r = agesAt('1997-09-01T00:00:00.000Z', rows)
    expect(r.map(a => [a.state, a.age])).toEqual([['age', 7], ['age', 37], ['age', 42], ['unknown', undefined]])
    expect(agesAt('1985-01-01', rows)[0].state).toBe('unborn')
    expect(agesAt('2020-01-01', rows)[2]).toMatchObject({ state: 'dead', age: 60 })
  })
})

describe('labels and lanes', () => {
  it('alternates labels above and below, and drops one that would overlap on both sides', () => {
    const items = [{ id: 'a', x: 0 }, { id: 'b', x: 10 }, { id: 'c', x: 20 }, { id: 'd', x: 200 }]
    const out = placeLabels(items, 100)
    expect(out.get('a')).toBe('above')
    expect(out.get('b')).toBe('below')
    expect(out.has('c')).toBe(false)
    expect(out.get('d')).toBe('above')
  })

  it('puts overlapping chapters on separate lanes', () => {
    const lanes = chapterLanes([
      { id: '1', start: '2000-01-01', end: '2005-01-01' },
      { id: '2', start: '2003-01-01', end: '2004-01-01' },
      { id: '3', start: '2006-01-01', end: '2007-01-01' },
    ], NOW)
    expect(lanes.map(l => [l.chapter.id, l.lane])).toEqual([['1', 0], ['2', 1], ['3', 0]])
  })
})
