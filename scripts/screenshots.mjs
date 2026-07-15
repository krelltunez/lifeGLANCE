// Generates Google Play Store screenshots (phone + tablet) by driving the built
// web app with Chromium via Playwright, seeded from the demo backup
// (lifeglance-jake-chen-test.json).
//
//   npm run screenshots
//     → builds the app, serves dist/ in-process, seeds the demo data, and
//       captures every SCENE at every DEVICE into play-assets/screenshots/<device>/.
//
// To change what gets shot in future, edit DEVICES / SCENES below and re-run —
// that's the whole point of this file: one command regenerates the full set.
//
// Env overrides:
//   URL=<origin>          serve from an already-running server instead of dist/
//   CHROMIUM_PATH=<bin>   browser binary (defaults to the Playwright chromium;
//                         on CI, `npx playwright install chromium` then unset this)
//   PORT=<n>              local port for the built-in static server

import { chromium } from 'playwright-core'
import { readFile, mkdir, rm, stat, access } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import path from 'node:path'

/* global indexedDB -- referenced only inside page.evaluate(), which runs in the browser */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const DEMO = path.join(ROOT, 'lifeglance-jake-chen-test.json')
const OUT  = path.join(ROOT, 'play-assets', 'screenshots')
const PORT = Number(process.env.PORT || 4173)
const BASE = process.env.URL || `http://localhost:${PORT}`
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BIRTHDAY = '1998-11-03' // Jake's birth date → ages render on milestones/detail

// CSS viewport picks the app's responsive layout; deviceScaleFactor upscales to
// Play's pixel dimensions. lifeGLANCE is a LANDSCAPE app (it shows a "rotate your
// device" prompt in portrait), so these are landscape; each ≤ 3840 px, ratio ≤ 2:1.
// The CSS widths are sized to a real device's landscape logical resolution so the
// header and timeline breathe (a too-narrow viewport packs everything together).
const DEVICES = [
  { id: 'phone',    width: 960,  height: 540, scale: 2 },   // → 1920 × 1080
  { id: 'tablet7',  width: 1280, height: 800, scale: 1.5 }, // → 1920 × 1200
  { id: 'tablet10', width: 1280, height: 800, scale: 2 },   // → 2560 × 1600
]

// Each scene starts on a seeded timeline; `setup` navigates to the shot. Keep
// scenes independent — the page is re-seeded fresh for every (device, scene).
const SCENES = [
  { id: 'timeline', devices: ['phone', 'tablet7', 'tablet10'],
    async setup(page, device) {
      // Show milestone CARDS, not clustered dots. Pick the zoom by device:
      //   phone   → 'weeks' (±3 mo): the narrow viewport only breathes with one
      //             hero card, so keep the window tight.
      //   tablets → 'months' (±18 mo): the wide viewport has room, so open the
      //             window to a ~3-year span that fills the frame with SEVERAL
      //             individual cards, cluster badges, and colored chapter bars —
      //             far more interesting than a single lonely card. ('years' and
      //             wider collapse everything into clustered dots — no cards.)
      // Both are presets, never the sloppy 'custom'. ArrowLeft then focuses
      // successively older past milestones (milestone-relative, so it composes
      // the same at any zoom), panning the dense "today" burst off-frame.
      const tablet = device.id !== 'phone'
      await setZoom(page, tablet ? 'months' : 'weeks')
      for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(350) }
      await page.waitForTimeout(600)
    } },

  { id: 'milestone-detail', devices: ['phone', 'tablet10'],
    async setup(page) {
      // Open a specific milestone's detail sheet via search ('/' → type → pick):
      // handleSearchSelect calls setDetail(). More reliable than clicking a
      // clustered SVG node, which would drill into a chapter instead.
      await page.keyboard.press('/')
      const input = page.locator('.search-input')
      await input.waitFor({ timeout: 4000 })
      await input.fill('High school graduation')
      await page.waitForTimeout(300)
      await page.locator('.search-result').first().click()
      await page.waitForTimeout(600)
    } },

  { id: 'add-milestone', devices: ['phone'],
    async setup(page) {
      await page.locator('.add-milestone-btn').first().click()
      await page.waitForTimeout(500)
    } },

  { id: 'filter', devices: ['phone'],
    async setup(page) {
      await page.locator('.filter-compact').first().click()
      await page.waitForTimeout(400)
    } },

  { id: 'settings', devices: ['phone', 'tablet7'],
    async setup(page) {
      await page.getByRole('button', { name: /^settings$/i }).first().click()
      await page.waitForTimeout(500)
    } },
]

// Pick a zoom preset. The control is a dropdown on narrow viewports and inline
// tabs on wide ones, so handle both.
async function setZoom(page, label) {
  const dropdown = page.locator('.zoom-dropdown-btn')
  if (await dropdown.count()) {
    await dropdown.first().click()
    await page.waitForTimeout(250)
    await page.locator('.zoom-dropdown-item', { hasText: label }).first().click()
  } else {
    await page.locator('.zoom-tab', { hasText: label }).first().click()
  }
  await page.waitForTimeout(700)
}

// Seed the demo backup straight into IndexedDB (mirroring restoreMilestones in
// src/data/milestones.js) so the app boots into a populated timeline — no
// onboarding, no UI restore. DB name/version/stores mirror src/data/db.js.
async function seed(page, demo) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900) // let initDB() create the 'lifeglance' DB + stores
  await page.evaluate(async ({ milestones, chapters, birthday }) => {
    const clean = milestones.map(({ photo_uri: _drop, ...m }) => ({
      mainTimelineVisibility: 'inherit',
      dayglance_linked: false, dayglance_task_id: null,
      dayglance_completed: false, dayglance_completed_at: null,
      ...m, media_type: null, has_photo: false,
    }))
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('lifeglance', 6)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(['milestones', 'chapters'], 'readwrite')
        tx.objectStore('milestones').clear()
        tx.objectStore('chapters').clear()
        for (const m of clean) tx.objectStore('milestones').put(m)
        for (const c of chapters) tx.objectStore('chapters').put(c)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
    localStorage.setItem('lifeglance-birthday', birthday)
    localStorage.setItem('lifeglance-birthday-updated-at', new Date(0).toISOString())
  }, { milestones: demo.milestones, chapters: demo.chapters, birthday: BIRTHDAY })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.add-milestone-btn').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(800) // timeline entrance animation settles
}

// Minimal static server for dist/ with SPA fallback — no external dev server,
// no child process to manage.
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
}
function serveDist(dir, port) {
  const server = http.createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      let fp = path.join(dir, p === '/' ? '/index.html' : p)
      let s = await stat(fp).catch(() => null)
      if (!s || s.isDirectory()) { fp = path.join(dir, 'index.html'); s = await stat(fp).catch(() => null) }
      if (!s) { res.writeHead(404); return res.end('not found') }
      res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' })
      createReadStream(fp).pipe(res)
    } catch { res.writeHead(500); res.end('error') }
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

async function main() {
  if (!process.env.URL) {
    await access(path.join(DIST, 'index.html')).catch(() => {
      throw new Error('dist/ not found — run `npm run build` first (npm run screenshots does this for you).')
    })
  }
  const demo = JSON.parse(await readFile(DEMO, 'utf8'))
  const server = process.env.URL ? null : await serveDist(DIST, PORT)
  // --no-sandbox / --disable-dev-shm-usage: the standard flags for headless
  // Chromium in containers/CI (avoids /dev/shm exhaustion and sandbox issues).
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const results = []
  try {
    for (const device of DEVICES) {
      const scenes = SCENES.filter(s => s.devices.includes(device.id))
      if (!scenes.length) continue
      await mkdir(path.join(OUT, device.id), { recursive: true })
      let n = 0
      for (const scene of scenes) {
        const ctx = await browser.newContext({
          viewport: { width: device.width, height: device.height },
          deviceScaleFactor: device.scale,
          serviceWorkers: 'block', // avoid the PWA SW caching a stale shell
          colorScheme: 'dark',
        })
        const page = await ctx.newPage()
        const file = path.join(OUT, device.id, `${String(++n).padStart(2, '0')}-${scene.id}.png`)
        try {
          await seed(page, demo)
          await scene.setup(page, device)
          await page.screenshot({ path: file })
          console.log(`  ✓ ${device.id}/${path.basename(file)}`)
        } catch (err) {
          results.push(false)
          console.log(`  ✗ ${device.id}/${scene.id} — ${err.message.split('\n')[0]}`)
        }
        await ctx.close()
      }
    }
  } finally {
    await browser.close()
    server?.close()
  }
  console.log('\nDone → play-assets/screenshots/')
  if (results.includes(false)) process.exitCode = 1
}

await rm(OUT, { recursive: true, force: true })
await main()
