// Generates the App Store and Google Play screenshots by driving the built web
// app with Chromium via Playwright, seeded from the demo backup
// (lifeglance-jake-chen-test.json) re-dated to run time.
//
//   npm run screenshots
//     → builds the app, serves dist/ in-process, captures every PANE, writes the
//       Play frames straight out, then hands the panes to
//       scripts/compose-apple-frames.py to build the captioned Apple canvases.
//
// Output (see store-assets/README.md):
//   store-assets/play/<device>/      raw app surface, full bleed, no caption
//   store-assets/apple/<device>/     captioned canvases composed from the panes
//
// lifeGLANCE's house style is NO device chrome: no bezels, no status bars, no
// home indicators. The app surface bleeds to the canvas edges. The Apple iPhone
// canvas is portrait and the app is landscape, which is why that canvas stacks
// two landscape panes — one shot, two moments.
//
// Env overrides:
//   URL=<origin>          serve from an already-running server instead of dist/
//   CHROMIUM_PATH=<bin>   browser binary (otherwise auto-detected)
//   PORT=<n>              local port for the built-in static server
//   KEEP_PANES=1          leave the intermediate pane captures on disk and print
//                         where, for debugging a composition

import { chromium } from 'playwright-core'
import { readFile, mkdir, rm, stat, access, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import http from 'node:http'
import path from 'node:path'

/* global indexedDB -- referenced only inside page.evaluate(), which runs in the browser */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const DEMO = path.join(ROOT, 'src', 'demo', 'lifeglance-jake-chen-test.json')
const OUT  = path.join(ROOT, 'store-assets')
const PANES = path.join(tmpdir(), `lifeglance-panes-${process.pid}`)
const PORT = Number(process.env.PORT || 4173)
const BASE = process.env.URL || `http://localhost:${PORT}`

// Playwright's browser directory is versioned, so a hardcoded path goes stale
// the moment the image is rebuilt — it already had, pointing at chromium-1194
// when this container shipped 1243 under a different chrome-linux64/ layout.
// Resolve instead: the stable symlink first, then any versioned install.
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const candidates = [
    '/opt/pw-browsers/chromium',
    ...['chrome-linux64/chrome', 'chrome-linux/chrome'].flatMap(suffix =>
      ['1243', '1194'].map(v => `/opt/pw-browsers/chromium-${v}/${suffix}`)),
  ]
  const hit = candidates.find(p => existsSync(p))
  if (!hit) {
    throw new Error(
      'no Chromium found. Set CHROMIUM_PATH, or run `npx playwright install chromium`.',
    )
  }
  return hit
}

/* ------------------------------------------------------------------ seed ---
 * The demo backup was authored around a notional "today" of 12 July 2026, and
 * a timeline seed rots: every milestone it calls upcoming becomes past, the
 * future half of the app empties out, and the relative ages ("1 yr, 8 mo ago",
 * "27 y.o.") drift. So shift the whole story to run time instead of pinning it.
 *
 * A uniform shift in DAYS, not years: it keeps every interval, age and chapter
 * span exactly as authored, and it lands "today" at the same point in the story
 * the set was composed around — which is what keeps the timeline busy near the
 * today marker. Shifting by whole years would preserve calendar dates but leave
 * an eight-month hole either side of today, and every shot looks at today.
 */
const SEED_ANCHOR = Date.UTC(2026, 6, 12) // the notional "today" the demo was written for
const DAY = 86400000

// Milestones whose title asserts a calendar date. A day shift would put
// Thanksgiving in March, which is the one break a reader would actually catch.
// These keep their authored date. (The annual recurrences — Dustin's birthday,
// the Vegas trip — need no exemption: every instance shifts together, so the
// series stays internally consistent on whatever date it lands.)
const CALENDAR_LOCKED = [/thanksgiving/i, /new year/i, /christmas/i]

// Scenes look these up by title, so thinning must never drop them.
const PROTECTED = [
  /Brother Tyler's wedding/i, /First day at Brex/i, /Backpacked Europe/i,
  /Parents' 25th anniversary/i, /Promoted to senior analyst/i,
  /College graduation/i, /Thanksgiving/i, /30th birthday trip/i,
]

// Dropped outright. The months either side of today are the busiest stretch of
// the seed and several entries there are protected, so one unprotected card
// lands on top of its neighbours in every wide shot. This is the least
// interesting of that cluster, and cutting it clears the last collision.
const EXCLUDE = [/Lease renewal decision/i]

// Keep every Nth milestone. At the wide zooms the seed is far denser than the
// lane algorithm can place: a +/-10 year view needs ~24 lanes to lay 47
// milestones out without collisions and the layout can offer at most six, so
// the cards land on top of each other. Thinning is the only lever that closes
// that gap — viewport and text size together buy two or three lanes, not
// eighteen. Applied globally rather than per-view so every frame in a gallery
// agrees on the past/future counters, which are visible in the shot.
// One value for every gallery. It was briefly split, phone against tablet,
// to rescue shot 1 — but the real fault there was the zoom, not the density
// (see the `wholeLife` scene), and splitting it gave the two galleries
// different "past N milestones" counters for no benefit.
const KEEP_EVERY = 3

// The thinned timeline otherwise dead-ends in early 2029 with a decade of bare
// axis to its right. Three aspirational entries, deliberately unevenly spaced,
// carry the eye out to the edge of the window. They follow the persona's
// existing threads (the apartment, the travel habit, the management track)
// rather than inventing a new life.
const HORIZON = [
  { daysAhead: 1248, title: 'Pay off the mortgage',   category: 'home',   date_precision: 'year'  },
  { daysAhead: 2145, title: 'Six months in Lisbon',   category: 'travel', date_precision: 'month' },
  { daysAhead: 3135, title: 'Director (goal)',        category: 'career', date_precision: 'year'  },
]

function thinAndExtend(milestones, now) {
  const keep = milestones
    .filter(m => !EXCLUDE.some(re => re.test(m.title)))
    .filter((m, i) => i % KEEP_EVERY === 0 || PROTECTED.some(re => re.test(m.title)))
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const horizon = HORIZON.map((h, i) => ({
    id: `90000${i}-0000-4000-8000-00000000000${i}`,
    title: h.title, category: h.category, date_precision: h.date_precision,
    date: new Date(base + h.daysAhead * DAY).toISOString(),
    direction: 'future', color: null, note: '', url: null,
    recurrence: null, recurrence_id: null,
    created_at: new Date(base).toISOString(), updated_at: new Date(base).toISOString(),
  }))
  return [...keep, ...horizon]
}

function redate(demo, now = new Date()) {
  const shift = Math.round((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - SEED_ANCHOR) / DAY)
  const move = (iso) => new Date(Date.parse(iso) + shift * DAY).toISOString()

  const milestones = demo.milestones.map(m => ({
    ...m,
    date: CALENDAR_LOCKED.some(re => re.test(m.title)) ? m.date : move(m.date),
  }))
  const chapters = demo.chapters.map(c => ({
    ...c,
    start: c.start ? move(c.start) : c.start,
    end:   c.end   ? move(c.end)   : c.end,
  }))

  // "On this day" only renders a button when some past milestone shares today's
  // month and day, so a shot of it is otherwise a coin flip. Nudge every past
  // milestone already within a week of the anniversary onto it — a 2-6 day move
  // that costs nothing and reliably fills the panel from several different years.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const nudged = []
  for (const m of milestones) {
    const d = new Date(Date.parse(m.date))
    if (d >= today) continue
    const anniv = Date.UTC(d.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    const off = Math.round((d.getTime() - anniv) / DAY)
    if (Math.abs(off) > 7 || off === 0) continue
    // Set the calendar fields rather than subtracting `off` days: not every
    // seed timestamp is UTC midnight, and the rounding there lands a day out.
    const moved = new Date(d)
    moved.setUTCMonth(today.getUTCMonth(), today.getUTCDate())
    m.date = moved.toISOString()
    nudged.push(`${m.title} (${off > 0 ? '-' : '+'}${Math.abs(off)}d)`)
  }

  const birthdayMs = Date.parse(demo.milestones.find(m => /was born/i.test(m.title))?.date ?? '1998-11-03')
  const birthday = new Date(birthdayMs + shift * DAY).toISOString().slice(0, 10)
  const shaped = thinAndExtend(milestones, now)
  return { milestones: shaped, chapters, birthday, shift, nudged,
           counts: `${milestones.length} seeded -> ${shaped.length} after thinning + horizon` }
}

/* ---------------------------------------------------------------- scenes ---
 * Each returns with the app sitting on the shot. Keep them independent: the
 * page is re-seeded fresh for every pane.
 */
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

// Centre the timeline on a milestone by searching for it. Selecting a result
// opens the detail sheet (handleSearchSelect calls setDetail), so close it again
// when the shot wants the timeline itself — the pan survives the close.
async function focusMilestone(page, query, { keepDetail = false } = {}) {
  await page.keyboard.press('/')
  const input = page.locator('.search-input')
  await input.waitFor({ timeout: 4000 })
  await input.fill(query)
  await page.waitForTimeout(350)
  await page.locator('.search-result').first().click()
  await page.waitForTimeout(650)
  if (!keepDetail) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }
}

const scenes = {
  // The widest span that still fills the pane. '30yr' is a SIXTY year window
  // (the preset names its half-range), which on a 27-year life leaves the outer
  // thirds bare and crushes everything into the middle, where it piles up no
  // matter how hard the seed is thinned. 'years' is twenty years: it loses the
  // childhood, but it spreads the cards across the full width, and the today
  // marker and age readout — the two things that must survive Apple's
  // thumbnail — are more legible for it.
  wholeLife: async (page) => {
    await setZoom(page, 'years')
    await page.waitForTimeout(700)
  },
  // The close end of the same span: individual cards, dates, ages. 'months'
  // rather than 'weeks' because the thinned seed leaves a +/-3 month window
  // with a single milestone in it.
  closeUp: async (page) => {
    await setZoom(page, 'months')
    for (let i = 0; i < 2; i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(320) }
    await page.waitForTimeout(600)
  },
  // Several chapter ribbons at once, so the banding reads as structure.
  chaptersWide: async (page) => {
    await setZoom(page, 'years')
    await focusMilestone(page, 'College graduation')
  },
  // One labelled ribbon over the milestones it contains — the chapter idea
  // explaining itself rather than decorating the axis.
  chaptersClose: async (page) => {
    await setZoom(page, 'months')
    await focusMilestone(page, 'Promoted to senior analyst')
  },
  // The half of the pitch the old set never showed.
  futureView: async (page) => {
    await page.keyboard.press('f')
    await page.waitForTimeout(500)
    await setZoom(page, 'months')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(700)
  },
  futureCountdown: async (page) => {
    await setZoom(page, 'months')
    await focusMilestone(page, "Brother Tyler's wedding", { keepDetail: true })
  },
  onThisDay: async (page) => {
    const btn = page.locator('.otd-btn')
    await btn.waitFor({ timeout: 8000 })
    await btn.first().click()
    await page.waitForTimeout(600)
  },
  onThisDayContext: async (page) => {
    await setZoom(page, 'months')
    await focusMilestone(page, 'First day at Brex', { keepDetail: true })
  },
  // The precision tabs are the point: "as exact or as fuzzy as you like".
  addMilestone: async (page) => {
    await page.locator('.add-milestone-btn').first().click()
    await page.waitForTimeout(600)
    await page.locator('.precision-tabs').waitFor({ timeout: 4000 })
    await page.keyboard.type('Weekend in the Catskills', { delay: 12 })
    const year = page.locator('.sheet input[type="number"]').last()
    await year.fill('2019')
    await page.waitForTimeout(350)
  },
  // Tablet scenes.
  ipadTimeline: async (page) => {
    await setZoom(page, 'years')
    await page.waitForTimeout(800)
  },
  wideTimeline: async (page) => {
    await setZoom(page, 'months')
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(320) }
    await page.waitForTimeout(600)
  },
  milestoneDetail: async (page) => {
    await focusMilestone(page, 'College graduation', { keepDetail: true })
  },
}

/* ----------------------------------------------------------------- panes ---
 * A pane is one raw app capture: viewport picks the responsive layout, scale
 * picks the output pixels. Nothing here knows about canvases or captions.
 */
// Viewport heights are chosen, not inherited. Timeline.jsx flips to
// compactLayout at (max-height: 900px), which pins the axis near the bottom and
// stacks every card above it — the arrangement these frames want. Within that
// mode the lane count rises with height, so each viewport sits as close to 900
// CSS px as its output aspect allows: 792 bought four lanes, 880 buys six.
// deviceScaleFactor absorbs the difference, so output pixels are unchanged.
const PHONE_APPLE = { width: 1206, height: 860, scale: 1 }    // → 1206 x 860 1:1, two stacked per canvas
const PHONE_PLAY  = { width: 1200, height: 675, scale: 1.6 }  // → 1920 x 1080, Play phone slot as shipped
const TAB7        = { width: 1422, height: 889, scale: 1.35 } // → 1920 x 1200
const TAB10       = { width: 1422, height: 889, scale: 1.8 }  // → 2560 x 1600
const IPAD        = { width: 1529, height: 880, scale: 1.8 }  // → 2752 x 1584, under the 480px caption band
// The add sheet is a modal: at the wider phone viewport it floated in a sea of
// dimmed backdrop. A tighter viewport lets the sheet carry the pane.
const SHEET_APPLE = { width: 760, height: 690, scale: 2 }   // → 1520 x 1380; tall enough that the sheet is not clipped
// Same 16:9 Play phone slot, but a taller CSS viewport so the add sheet fits
// instead of being cut off mid-category-row: 1120 x 630 x 1.7143 = 1920 x 1080.
const SHEET_PLAY  = { width: 1120, height: 630, scale: 1920 / 1120 }

const PANE_SET = [
  // Apple iPhone — two panes per shot, stacked by the compositor.
  { id: 'iphone/01a', vp: PHONE_APPLE, scene: 'wholeLife' },
  { id: 'iphone/01b', vp: PHONE_APPLE, scene: 'closeUp' },
  { id: 'iphone/02a', vp: PHONE_APPLE, scene: 'chaptersWide' },
  { id: 'iphone/02b', vp: PHONE_APPLE, scene: 'chaptersClose' },
  { id: 'iphone/03a', vp: PHONE_APPLE, scene: 'futureView' },
  { id: 'iphone/03b', vp: PHONE_APPLE, scene: 'futureCountdown' },
  { id: 'iphone/04a', vp: PHONE_APPLE, scene: 'onThisDay' },
  { id: 'iphone/04b', vp: PHONE_APPLE, scene: 'onThisDayContext' },
  { id: 'iphone/05a', vp: SHEET_APPLE, scene: 'addMilestone' },
  // Apple iPad — one pane per shot.
  { id: 'ipad/06a', vp: IPAD, scene: 'ipadTimeline' },
  { id: 'ipad/07a', vp: IPAD, scene: 'milestoneDetail' },
  // Google Play — written straight out, no composition.
  { id: 'play/phone/01-decades',       vp: PHONE_PLAY, scene: 'wholeLife' },
  { id: 'play/phone/02-chapters',      vp: PHONE_PLAY, scene: 'chaptersClose' },
  { id: 'play/phone/03-future',        vp: PHONE_PLAY, scene: 'futureCountdown' },
  { id: 'play/phone/04-on-this-day',   vp: PHONE_PLAY, scene: 'onThisDay' },
  { id: 'play/phone/05-add-milestone', vp: SHEET_PLAY, scene: 'addMilestone' },
  { id: 'play/tablet7/01-timeline',    vp: TAB7,  scene: 'wideTimeline' },
  { id: 'play/tablet7/02-milestone-detail', vp: TAB7, scene: 'milestoneDetail' },
  { id: 'play/tablet10/01-timeline',   vp: TAB10, scene: 'wideTimeline' },
  { id: 'play/tablet10/02-milestone-detail', vp: TAB10, scene: 'milestoneDetail' },
]

// Seed the demo backup straight into IndexedDB (mirroring restoreMilestones in
// src/data/milestones.js) so the app boots into a populated timeline — no
// onboarding, no UI restore. DB name/version/stores mirror src/data/db.js.
async function seed(page, data) {
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
    // Both are ordinary user settings, and both are load-bearing for these shots.
    //
    // clustering: with it on, every wide zoom collapses milestones into numbered
    // circles and no card draws at all (Timeline.jsx line ~286 routes only
    // single-member groups to the card renderer), so the frame is an empty axis.
    //
    // text size: CARD_W, CARD_H2 and CARD_STEP all scale off remPx (19 at
    // 'small' against 22 at 'normal'), so dropping a step makes cards narrower
    // AND shorter — fewer horizontal collisions and an extra lane to resolve
    // the ones that remain. It is the cheapest lever on card pile-up.
    localStorage.setItem('lifeglance-clustering', 'false')
    localStorage.setItem('lifeglance-text-size', 'small')
  }, { milestones: data.milestones, chapters: data.chapters, birthday: data.birthday })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.add-milestone-btn').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(800) // timeline entrance animation settles
}

// Minimal static server for dist/ with SPA fallback.
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

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' })
    p.on('error', reject)
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)))
  })
}

async function main() {
  if (!process.env.URL) {
    await access(path.join(DIST, 'index.html')).catch(() => {
      throw new Error('dist/ not found — run `npm run build` first (npm run screenshots does this for you).')
    })
  }
  const demo = JSON.parse(await readFile(DEMO, 'utf8'))
  const data = redate(demo)
  console.log(`Seed re-dated +${data.shift}d to today; birthday ${data.birthday}`)
  console.log(`  ${data.counts}`)
  if (data.nudged.length) console.log(`  on-this-day nudges: ${data.nudged.join(', ')}`)

  const server = process.env.URL ? null : await serveDist(DIST, PORT)
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const failed = []
  try {
    for (const pane of PANE_SET) {
      // A play/* pane is a finished frame; everything else is raw material.
      const isPlay = pane.id.startsWith('play/')
      const file = path.join(isPlay ? OUT : PANES, `${pane.id}.png`)
      await mkdir(path.dirname(file), { recursive: true })
      const ctx = await browser.newContext({
        viewport: { width: pane.vp.width, height: pane.vp.height },
        deviceScaleFactor: pane.vp.scale,
        serviceWorkers: 'block', // avoid the PWA SW caching a stale shell
        colorScheme: 'dark',
      })
      const page = await ctx.newPage()
      try {
        await seed(page, data)
        await scenes[pane.scene](page)
        await page.screenshot({ path: file })
        console.log(`  ✓ ${pane.id}`)
      } catch (err) {
        failed.push(pane.id)
        console.log(`  ✗ ${pane.id} — ${err.message.split('\n')[0]}`)
      }
      await ctx.close()
    }
  } finally {
    await browser.close()
    server?.close()
  }

  if (failed.length) {
    console.error(`\n${failed.length} pane(s) failed: ${failed.join(', ')}`)
    process.exitCode = 1
    return
  }

  await writeFile(path.join(PANES, 'seed-info.json'), JSON.stringify(data, null, 2))
  console.log('\nComposing Apple canvases…')
  await run('python3', [path.join(ROOT, 'scripts', 'compose-apple-frames.py'), PANES, OUT])

  if (process.env.KEEP_PANES) console.log(`\nPanes kept at ${PANES}`)
  else await rm(PANES, { recursive: true, force: true })
  console.log(`Done → ${path.relative(ROOT, OUT)}/`)
}

// Clear only the generated galleries: store-assets/README.md is hand-written
// and lives in the same directory, so removing OUT wholesale would eat it.
for (const gallery of ['apple', 'play']) {
  await rm(path.join(OUT, gallery), { recursive: true, force: true })
}
await rm(PANES, { recursive: true, force: true })
await main()
