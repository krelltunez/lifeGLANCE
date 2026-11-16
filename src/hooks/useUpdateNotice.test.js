import { describe, it, expect } from 'vitest'
import { noticeFor } from './useUpdateNotice.js'

describe('noticeFor', () => {
  const release = { version: '5.2.0', url: 'https://github.com/krelltunez/lifeGLANCE/releases/tag/v5.2.0' }

  it('shows a release main reports', () => {
    expect(noticeFor(release, null)).toEqual(release)
  })

  it('stays quiet for a version that was dismissed, and shows a newer one again', () => {
    expect(noticeFor(release, '5.2.0')).toBeNull()
    expect(noticeFor({ ...release, version: '5.3.0' }, '5.2.0')).toEqual({ ...release, version: '5.3.0' })
  })

  it('shows nothing for no release or a malformed answer', () => {
    expect(noticeFor(null, null)).toBeNull()
    expect(noticeFor({ version: 5, url: release.url }, null)).toBeNull()
    expect(noticeFor({ version: '5.2.0' }, null)).toBeNull()
  })
})
