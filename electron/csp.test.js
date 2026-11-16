import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { contentSecurityPolicy, inlineScriptHashes } from './csp.js'

const directive = (policy, name) => policy.split('; ').find((d) => d.startsWith(`${name} `))
const sha = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`

describe('inlineScriptHashes', () => {
  it('hashes each inline script exactly as written, and skips scripts with a src', () => {
    const html = '<head><script>\n  var a = 1;\n</script><script type="module" src="/assets/index.js"></script><SCRIPT>b()</SCRIPT></head>'
    expect(inlineScriptHashes(html)).toEqual([sha('\n  var a = 1;\n'), sha('b()')])
  })

  it('finds nothing in a document with no inline script', () => {
    expect(inlineScriptHashes('<html><body><script src="/a.js"></script></body></html>')).toEqual([])
    expect(inlineScriptHashes('')).toEqual([])
  })

  it('covers the boot scripts index.html ships', () => {
    // The theme script must run before first paint; a hash that stops matching
    // would block it with nothing but a console line to show for it.
    const html = fs.readFileSync(path.resolve(import.meta.dirname, '../index.html'), 'utf-8')
    const hashes = inlineScriptHashes(html)
    expect(hashes).toHaveLength(2)
    expect(html).toContain("localStorage.getItem('lifeglance-theme')")
  })
})

describe('contentSecurityPolicy', () => {
  const policy = contentSecurityPolicy({ scriptHashes: ["'sha256-abc='"] })

  it('allows only the bundle’s own scripts and the hashed inline ones', () => {
    expect(directive(policy, 'script-src')).toBe("script-src 'self' 'sha256-abc='")
    expect(directive(contentSecurityPolicy(), 'script-src')).toBe("script-src 'self'")
    expect(policy).not.toContain('unsafe-eval')
    expect(directive(policy, 'script-src')).not.toContain('unsafe-inline')
  })

  it('lets decrypted media play from object URLs', () => {
    expect(directive(policy, 'img-src')).toBe("img-src 'self' data: blob:")
    expect(directive(policy, 'media-src')).toBe("media-src 'self' data: blob:")
  })

  it('allows the page no network request of its own', () => {
    // Sync goes through the main process. Loosening this hides a missed fetch
    // site behind a server's CORS rules.
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self' data: blob:")
    expect(policy).not.toMatch(/https?:/)
  })

  it('loads styles and the typeface from the bundle only', () => {
    expect(directive(policy, 'style-src')).toBe("style-src 'self' 'unsafe-inline'")
    expect(directive(policy, 'font-src')).toBe("font-src 'self' data:")
  })

  it('closes plugins, base tags, frames and form posts', () => {
    expect(directive(policy, 'object-src')).toBe("object-src 'none'")
    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'")
    expect(directive(policy, 'frame-src')).toBe("frame-src 'none'")
    expect(directive(policy, 'form-action')).toBe("form-action 'none'")
  })
})
