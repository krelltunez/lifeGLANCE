import { describe, it, expect } from 'vitest'
import { resolveWebdavBase, buildWebdavConfig } from './webdav.js'

describe('resolveWebdavBase', () => {
  it('appends the Nextcloud dav path for the nextcloud provider (trailing slash trimmed)', () => {
    expect(resolveWebdavBase('nextcloud', 'https://nc.example.com/', 'alice'))
      .toBe('https://nc.example.com/remote.php/dav/files/alice')
  })

  it('does not double-append when the dav path is already present', () => {
    const u = 'https://nc.example.com/remote.php/dav/files/alice'
    expect(resolveWebdavBase('nextcloud', u, 'alice')).toBe(u)
  })

  it('url-encodes the username', () => {
    expect(resolveWebdavBase('nextcloud', 'https://nc/', 'a b')).toBe('https://nc/remote.php/dav/files/a%20b')
  })

  it('uses the URL as-is for generic webdav / Synology (plain http + LAN IP untouched)', () => {
    expect(resolveWebdavBase('webdav', 'http://192.168.1.9:5005/lifeglance/', 'u'))
      .toBe('http://192.168.1.9:5005/lifeglance')
  })

  it('uses the URL as-is for koofr', () => {
    expect(resolveWebdavBase('koofr', 'https://app.koofr.net/dav/Koofr', 'u')).toBe('https://app.koofr.net/dav/Koofr')
  })
})

describe('buildWebdavConfig', () => {
  it('carries auth + folder and sets the resolved webdavUrl (nextcloud)', () => {
    const c = buildWebdavConfig({ provider: 'nextcloud', url: 'https://nc/', username: 'al', password: 'pw', folder: 'GLANCE/lifeglance' })
    expect(c).toMatchObject({
      provider: 'nextcloud',
      url: 'https://nc/',
      username: 'al',
      password: 'pw',
      folder: 'GLANCE/lifeglance',
      enabled: true,
      webdavUrl: 'https://nc/remote.php/dav/files/al',
      nextcloudUrl: 'https://nc/',
      appPassword: 'pw',
    })
  })

  it('webdavUrl equals the raw url for a generic provider (Synology/fnOS)', () => {
    const c = buildWebdavConfig({ provider: 'webdav', url: 'http://nas:5005/lg', username: 'u', password: 'p', folder: 'x' })
    expect(c.webdavUrl).toBe('http://nas:5005/lg')
  })
})
