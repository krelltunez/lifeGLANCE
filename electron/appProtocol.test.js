import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_BASE_URL, APP_ORIGIN, contentTypeFor, resolveAppRequest } from './appProtocol.js'

const DIST = path.resolve('/opt/app/dist')
const files = new Set([
  path.join(DIST, 'index.html'),
  path.join(DIST, 'assets', 'index-abc.js'),
  path.join(DIST, 'assets', 'index-abc.css'),
  path.join(DIST, 'icon-192x192.png'),
])
const isFile = (p) => files.has(p)
const resolve = (url) => resolveAppRequest(DIST, url, isFile)

describe('the app:// origin', () => {
  it('is app://lifeglance, with no trailing slash', () => {
    // Chromium gives a registered standard scheme this origin. (Node's URL
    // answers 'null' for a scheme it does not know, so the parts are checked.)
    expect(APP_ORIGIN).toBe('app://lifeglance')
    expect(APP_BASE_URL).toBe('app://lifeglance/')
    expect(new URL(APP_BASE_URL)).toMatchObject({ protocol: 'app:', host: 'lifeglance', pathname: '/' })
  })
})

describe('resolveAppRequest', () => {
  it('serves index.html for the root, whatever the query', () => {
    expect(resolve('app://lifeglance/')).toEqual({ status: 200, filePath: path.join(DIST, 'index.html'), contentType: 'text/html; charset=utf-8' })
    expect(resolve('app://lifeglance/?demo=1').filePath).toBe(path.join(DIST, 'index.html'))
  })

  it('serves an existing file with its content type', () => {
    expect(resolve('app://lifeglance/assets/index-abc.js')).toEqual({ status: 200, filePath: path.join(DIST, 'assets', 'index-abc.js'), contentType: 'text/javascript; charset=utf-8' })
    expect(resolve('app://lifeglance/assets/index-abc.css').contentType).toBe('text/css; charset=utf-8')
    expect(resolve('app://lifeglance/icon-192x192.png').contentType).toBe('image/png')
  })

  it('answers 404 for anything that is not a file, never the app HTML', () => {
    expect(resolve('app://lifeglance/assets/renamed.js')).toEqual({ status: 404 })
    expect(resolve('app://lifeglance/api/webdav-proxy')).toEqual({ status: 404 })
    expect(resolve('app://lifeglance/assets')).toEqual({ status: 404 })
  })

  it('refuses a path that leaves dist', () => {
    // An encoded slash survives URL parsing and is decoded here.
    expect(resolve('app://lifeglance/..%2f..%2fsecret.txt')).toEqual({ status: 403 })
    expect(resolveAppRequest(DIST, 'app://lifeglance/..%2fdist-evil%2fx.js', () => true)).toEqual({ status: 403 })
    expect(resolveAppRequest(DIST, 'app://lifeglance/assets%2f..%2f..%2f..%2fetc%2fpasswd', () => true)).toEqual({ status: 403 })
  })

  it('keeps dot segments the URL parser already folded inside dist', () => {
    // new URL() resolves ../ and %2e%2e/ against the root before this sees them.
    expect(resolve('app://lifeglance/%2e%2e/%2e%2e/etc/passwd')).toEqual({ status: 404 })
    expect(resolveAppRequest(DIST, 'app://lifeglance/../../etc/passwd', () => true).filePath).toBe(path.join(DIST, 'etc', 'passwd'))
  })

  it('answers 404 for another host or a malformed URL', () => {
    expect(resolve('app://elsewhere/index.html')).toEqual({ status: 404 })
    expect(resolve('not a url')).toEqual({ status: 404 })
    expect(resolve('app://lifeglance/%E0%A4%A')).toEqual({ status: 404 })
  })
})

describe('contentTypeFor', () => {
  it('knows the kinds a Vite build emits, case-insensitively', () => {
    expect(contentTypeFor('a/b.woff2')).toBe('font/woff2')
    expect(contentTypeFor('ICON.SVG')).toBe('image/svg+xml')
    expect(contentTypeFor('data.bin')).toBe('application/octet-stream')
  })
})
