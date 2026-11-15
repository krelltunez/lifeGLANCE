// The Content-Security-Policy for the app's document (docs/desktop-app.md,
// "Hardening"). index.html is shared with the web build and the phones and
// carries no policy of its own, so the protocol handler sets this header on the
// document it serves.
//
//  - script-src: the bundle's own scripts, plus index.html's two inline boot
//    scripts (the theme before first paint) by hash. No other inline script,
//    no eval.
//  - style-src 'unsafe-inline': React sets inline style attributes. Google
//    Fonts is the typeface index.html links (Courier Prime), as on the web.
//  - img-src / media-src data: blob:: photos, video and audio are decrypted
//    into object URLs; exports draw SVG through a data URL.
//  - connect-src: the renderer still makes its own requests, as the web build
//    does: GLANCEvault, and WebDAV where the server allows the origin. When
//    sync moves into the main process this narrows to 'self' (the doc's
//    "What is next").
//  - object-src, base-uri, frame-src, form-action 'none': no plugins, no
//    base-tag injection, no frames, no form posts.

import { createHash } from 'node:crypto'

/**
 * The CSP hash source of every inline classic script in an HTML document, so
 * the policy admits exactly the scripts index.html ships and nothing injected
 * later. Scripts with a src are the bundle's and are covered by 'self'.
 *
 * @param {string} html
 * @returns {string[]} e.g. ["'sha256-…'"]
 */
export function inlineScriptHashes(html) {
  const hashes = []
  for (const m of String(html).matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/i.test(m[1] ?? '')) continue
    if (!m[2]) continue
    hashes.push(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`)
  }
  return hashes
}

/**
 * @param {object} [options]
 * @param {string[]} [options.scriptHashes] from inlineScriptHashes
 */
export function contentSecurityPolicy({ scriptHashes = [] } = {}) {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...scriptHashes].join(' '),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'self' https: http:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join('; ')
}
