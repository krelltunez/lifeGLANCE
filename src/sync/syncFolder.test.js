import { describe, expect, it } from 'vitest'
import { DEFAULT_SYNC_FOLDER, normalizeSyncFolder } from './syncFolder.js'

describe('normalizeSyncFolder', () => {
  it('strips the leading slash that produced //webdav/... URLs', () => {
    expect(normalizeSyncFolder('/webdav/GLANCE/lifeglance')).toBe('webdav/GLANCE/lifeglance')
  })

  it('strips trailing and repeated slashes, backslashes and "." segments', () => {
    expect(normalizeSyncFolder('GLANCE/lifeglance/')).toBe('GLANCE/lifeglance')
    expect(normalizeSyncFolder('GLANCE//lifeglance')).toBe('GLANCE/lifeglance')
    expect(normalizeSyncFolder('  /GLANCE/ lifeglance /  ')).toBe('GLANCE/lifeglance')
    expect(normalizeSyncFolder('GLANCE\\lifeglance')).toBe('GLANCE/lifeglance')
    expect(normalizeSyncFolder('./GLANCE/./lifeglance')).toBe('GLANCE/lifeglance')
  })

  it('leaves a clean folder untouched', () => {
    expect(normalizeSyncFolder('GLANCE/lifeglance')).toBe('GLANCE/lifeglance')
    expect(normalizeSyncFolder('lifeglance')).toBe('lifeglance')
  })

  it('falls back when nothing usable is left, including an empty folder', () => {
    expect(normalizeSyncFolder('')).toBe(DEFAULT_SYNC_FOLDER)
    expect(normalizeSyncFolder('/')).toBe(DEFAULT_SYNC_FOLDER)
    expect(normalizeSyncFolder(undefined)).toBe(DEFAULT_SYNC_FOLDER)
  })
})
