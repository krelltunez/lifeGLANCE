import { describe, expect, it } from 'vitest'
import { availableUpdate, compareVersions } from './updateCheck'

const release = (tag, assets, extra = {}) =>
  ({ tag_name: tag, html_url: `https://github.com/krelltunez/lifeGLANCE/releases/tag/${tag}`, draft: false, prerelease: false, assets: assets.map((name) => ({ name })), ...extra })

describe('the update check', () => {
  it('compares versions', () => {
    expect(compareVersions('3.0.1', '3.1.0')).toBe(1)
    expect(compareVersions('3.1.0', '3.1.0')).toBe(0)
    expect(compareVersions('v3.10.0', '3.9.9')).toBe(-1)
  })

  it('reports a newer release with a download for this OS', () => {
    const r = release('v3.1.0', ['lifeGLANCE-3.1.0-arm64.dmg', 'lifeGLANCE-Setup-3.1.0.exe', 'lifeGLANCE-3.1.0-x64.AppImage', 'lifeglance-github.apk'])
    expect(availableUpdate(r, '3.0.1', 'darwin')).toEqual({ version: '3.1.0', url: 'https://github.com/krelltunez/lifeGLANCE/releases/tag/v3.1.0' })
    expect(availableUpdate(r, '3.0.1', 'win32')?.version).toBe('3.1.0')
    expect(availableUpdate(r, '3.0.1', 'linux')?.version).toBe('3.1.0')
  })

  it('stays quiet for an Android-only release, the same version, drafts and pre-releases', () => {
    expect(availableUpdate(release('v3.1.0', ['lifeglance-github.apk']), '3.0.1', 'darwin')).toBeNull()
    expect(availableUpdate(release('v3.0.1', ['x.dmg']), '3.0.1', 'darwin')).toBeNull()
    expect(availableUpdate(release('v3.1.0', ['x.dmg'], { prerelease: true }), '3.0.1', 'darwin')).toBeNull()
    expect(availableUpdate(release('v3.1.0', ['x.dmg'], { html_url: 'https://evil.example/' }), '3.0.1', 'darwin')).toBeNull()
    expect(availableUpdate(null, '3.0.1', 'darwin')).toBeNull()
  })
})
