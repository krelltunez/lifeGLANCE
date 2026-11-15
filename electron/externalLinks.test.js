import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from './externalLinks.js'

describe('isAllowedExternalUrl', () => {
  it('allows web pages and mail', () => {
    expect(isAllowedExternalUrl('https://www.glance-apps.com/lifeglance')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com/a?b=c')).toBe(true)
    expect(isAllowedExternalUrl('mailto:hello@glance-apps.com')).toBe(true)
  })

  it('drops every other scheme', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'app://lifeglance/', 'smb://host/share', 'vscode://x', 'data:text/html,hi', 'blob:app://lifeglance/1']) {
      expect(isAllowedExternalUrl(url)).toBe(false)
    }
  })

  it('drops what is not a URL', () => {
    expect(isAllowedExternalUrl('')).toBe(false)
    expect(isAllowedExternalUrl('example.com')).toBe(false)
    expect(isAllowedExternalUrl(undefined)).toBe(false)
  })
})
