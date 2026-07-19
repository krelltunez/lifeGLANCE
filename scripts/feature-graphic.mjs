// Generates the Google Play feature graphic (play-assets/feature-graphic.png)
// by rendering the app's logo lockup with Chromium via Playwright.
//
//   npm run feature-graphic
//     → renders the 1024×500 banner and writes play-assets/feature-graphic.png
//
// Layout mirrors the in-app logo (src/index.css .logo): the icon on the left,
// then "life" (Courier Prime regular) + "GLANCE" (Courier Prime bold italic),
// with the tagline below.
//
// The font is VENDORED (scripts/assets/fonts, SIL OFL) and embedded as a data
// URI, so rendering needs no network — Chromium in some sandboxes can't reach
// Google Fonts (proxy TLS), and a silent fallback there is exactly the bug this
// replaces (the banner used to render with a stand-in font). The script proves
// Courier Prime actually rendered and refuses to output otherwise. Env override:
//   CHROMIUM_PATH=<bin>   browser binary (defaults to the Playwright chromium)

import { chromium } from 'playwright-core'
import { PNG } from 'pngjs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/* global document -- referenced only inside page.evaluate(), which runs in the browser */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ICON = path.join(ROOT, 'public', 'icon-master.svg')
const FONTS = path.join(ROOT, 'scripts', 'assets', 'fonts')
const OUT  = path.join(ROOT, 'play-assets', 'feature-graphic.png')
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const W = 1024, H = 500
const SCALE = 2 // render at 2× then box-downsample for crisp anti-aliased text

// Brand palette, matching the app (src/index.css). "life" = --text, the tagline
// = --text-muted; "GLANCE" uses the brighter brand purple (the icon + store
// wordmark colour) rather than the app's darker --indigo, per the reference art.
const BG = '#0F1117'
const LIFE = '#E8E0D0'
const GLANCE = '#9370DB'
const TAGLINE = 'rgba(232,224,208,0.45)'

// Inline the icon motif: strip the opaque background rect (so it sits tile-less
// on the banner) and crop the viewBox to the motif's bounding box (the source
// icon centres the motif in a 1024² square with wide margins, which would render
// tiny). Width/height attrs are dropped so CSS controls the size.
function iconMarkup(svg) {
  return svg
    .replace(/\s*<rect width="1024" height="1024" fill="#0f1117"\s*\/>/, '')
    .replace(/viewBox="0 0 1024 1024" width="1024" height="1024"/, 'viewBox="116 264 792 492"')
}

function buildHtml({ icon, reg, boldItalic }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  @font-face { font-family:"Courier Prime"; font-style:normal; font-weight:400;
    src:url(${reg}) format("truetype"); }
  @font-face { font-family:"Courier Prime"; font-style:italic; font-weight:700;
    src:url(${boldItalic}) format("truetype"); }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; }
  body {
    background:${BG};
    font-family:"Courier Prime", monospace;
    display:flex; align-items:center; justify-content:center; overflow:hidden;
  }
  .lockup { display:flex; align-items:center; gap:40px; }
  .icon { flex:none; display:flex; align-items:center; }
  .icon svg { height:196px; width:auto; display:block; }
  .text { display:flex; flex-direction:column; align-items:flex-start; }
  .wordmark { display:flex; align-items:baseline; line-height:1; letter-spacing:-0.02em; }
  .life   { font-weight:400; font-style:normal; font-size:78px; color:${LIFE}; }
  .glance { font-weight:700; font-style:italic; font-size:84px; color:${GLANCE}; }
  .tagline { font-style:normal; font-size:26px; color:${TAGLINE}; margin-top:14px; letter-spacing:0.02em; }
</style></head>
<body>
  <div class="lockup">
    <div class="icon">${iconMarkup(icon)}</div>
    <div class="text">
      <div class="wordmark"><span class="life">life</span><span class="glance">GLANCE</span></div>
      <div class="tagline">Your life, at a glance.</div>
    </div>
  </div>
</body></html>`
}

// Box-downsample a 2×-rendered RGBA screenshot to WxH and write it as a 24-bit
// truecolour PNG (colorType 2 → no alpha channel), matching Play's feature-graphic
// spec. Averaging each 2×2 block gives clean anti-aliasing on the wordmark.
function flattenAndHalve(buf) {
  const src = PNG.sync.read(buf)
  if (src.width !== W * SCALE || src.height !== H * SCALE) {
    throw new Error(`unexpected screenshot size ${src.width}×${src.height}, expected ${W * SCALE}×${H * SCALE}`)
  }
  const dst = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const i = (((y * SCALE + dy) * src.width) + (x * SCALE + dx)) << 2
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]
        }
      }
      const n = SCALE * SCALE
      const o = ((y * W) + x) << 2
      dst.data[o] = Math.round(r / n)
      dst.data[o + 1] = Math.round(g / n)
      dst.data[o + 2] = Math.round(b / n)
      dst.data[o + 3] = 255
    }
  }
  return PNG.sync.write(dst, { colorType: 2 })
}

const dataUri = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`

async function main() {
  const [icon, reg, boldItalic] = await Promise.all([
    readFile(ICON, 'utf8'),
    readFile(path.join(FONTS, 'CourierPrime-Regular.ttf')),
    readFile(path.join(FONTS, 'CourierPrime-BoldItalic.ttf')),
  ])
  const html = buildHtml({
    icon,
    reg: dataUri(reg, 'font/ttf'),
    boldItalic: dataUri(boldItalic, 'font/ttf'),
  })
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  try {
    const ctx = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: SCALE,
    })
    const page = await ctx.newPage()
    await page.setContent(html, { waitUntil: 'load' })

    // Prove Courier Prime actually rendered, not a fallback — the stand-in font
    // is the exact bug this generator replaces. load() resolves with the matched
    // FontFace(s) (or rejects on bad data); then confirm the applied font is
    // monospace, which Courier Prime is and a proportional fallback is not.
    const font = await page.evaluate(async () => {
      const faces = [
        ...await document.fonts.load('400 78px "Courier Prime"'),
        ...await document.fonts.load('italic 700 84px "Courier Prime"'),
      ]
      await document.fonts.ready
      const el = document.createElement('span')
      el.style.cssText = 'position:absolute;left:-9999px;font:400 78px "Courier Prime";white-space:pre'
      document.body.appendChild(el)
      el.textContent = 'i'; const iW = el.getBoundingClientRect().width
      el.textContent = 'W'; const wW = el.getBoundingClientRect().width
      el.remove()
      return { loaded: faces.length, iW, wW }
    })
    const monospace = Math.abs(font.iW - font.wW) < 0.5
    if (font.loaded < 2 || !monospace) {
      throw new Error(`Courier Prime did not render (loaded=${font.loaded}, i=${font.iW}, W=${font.wW}) — refusing to output a fallback-font banner.`)
    }

    const shot = await page.screenshot({ type: 'png' })
    await writeFile(OUT, flattenAndHalve(shot))
    console.log(`✓ wrote ${path.relative(ROOT, OUT)} (${W}×${H}, 24-bit RGB, Courier Prime)`)
  } finally {
    await browser.close()
  }
}

await main()
