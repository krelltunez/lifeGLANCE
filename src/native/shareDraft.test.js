import { describe, it, expect } from 'vitest'
import { shareToMilestoneDraft } from './shareDraft'

describe('shareToMilestoneDraft', () => {
  it('returns null for empty / invalid input', () => {
    expect(shareToMilestoneDraft(null)).toBeNull()
    expect(shareToMilestoneDraft(undefined)).toBeNull()
    expect(shareToMilestoneDraft({})).toBeNull()
    expect(shareToMilestoneDraft({ text: '   ', subject: '' })).toBeNull()
    expect(shareToMilestoneDraft('a string')).toBeNull()
  })

  it('uses the subject as the title and pulls the URL out of the text', () => {
    const d = shareToMilestoneDraft({ subject: 'Our new house', text: 'https://maps.example.com/x' })
    expect(d.title).toBe('Our new house')
    expect(d.url).toBe('https://maps.example.com/x')
    // text is exactly the url → no extra note
    expect(d.note).toBe('')
  })

  it('derives a title from text with the URL stripped when no subject', () => {
    const d = shareToMilestoneDraft({ text: 'Check this out https://example.com/article' })
    expect(d.url).toBe('https://example.com/article')
    expect(d.title).toBe('Check this out')
    expect(d.note).toBe('Check this out https://example.com/article')
  })

  it('falls back to the URL hostname when there is only a link', () => {
    const d = shareToMilestoneDraft({ text: 'https://www.example.com/path?q=1' })
    expect(d.url).toBe('https://www.example.com/path?q=1')
    expect(d.title).toBe('example.com') // www. stripped
  })

  it('handles plain text with no URL', () => {
    const d = shareToMilestoneDraft({ text: 'Graduated today!' })
    expect(d.url).toBe('')
    expect(d.title).toBe('Graduated today!')
    expect(d.note).toBe('') // text === title → no duplicate note
  })

  it('prefers subject over text for the title but keeps the text as a note', () => {
    const d = shareToMilestoneDraft({ subject: 'Trip', text: 'Two weeks in Japan, spring 2027' })
    expect(d.title).toBe('Trip')
    expect(d.note).toBe('Two weeks in Japan, spring 2027')
  })

  it('caps an over-long title and collapses whitespace', () => {
    const long = 'word '.repeat(60).trim() // ~300 chars, many spaces
    const d = shareToMilestoneDraft({ text: long })
    expect(d.title.length).toBeLessThanOrEqual(120)
    expect(d.title).not.toMatch(/\s{2,}/) // collapsed
    expect(d.note).toBe(long) // full text preserved
  })

  it('trims and ignores a blank subject', () => {
    const d = shareToMilestoneDraft({ subject: '   ', text: 'Milestone' })
    expect(d.title).toBe('Milestone')
  })
})
