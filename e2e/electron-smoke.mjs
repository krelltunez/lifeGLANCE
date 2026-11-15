#!/usr/bin/env node
// Desktop smoke test (docs/desktop-app.md, "Tests"): launch the PACKAGED app
// (electron-builder --dir output, so app.isPackaged is true and the real
// app:// protocol serves the bundle) on a fresh profile, and check what no unit
// test can see:
//
//   - the page is on app://lifeglance, the origin the data lives under;
//   - the preload exposed the bridge, with this machine's platform;
//   - the desktop chrome classes are set;
//   - the app rendered, and IndexedDB opened the `lifeglance` database there;
//   - no service worker registered;
//   - the CSP lets everything the app loads through (index.html's boot scripts
//     by hash) and blocks an injected script;
//   - the page's theme reaches the main process, for the next launch's window;
//   - the page's log lines reach the log file;
//   - iCloud: answered through the bridge on macOS, absent everywhere else;
//   - the wake signal reaches the page;
//   - the permissions the page is granted, and one it is not;
//   - a link opens in the browser, not in the app;
//   - an export (a blob download) is saved as a file;
//   - no uncaught page error.
//
// Usage: npm run build:electron:dir && npm run test:electron-smoke
// Linux CI runs it under xvfb-run. SMOKE_SCREENSHOT=path saves a screenshot.
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const executable = {
  linux: 'dist-app/linux-unpacked/lifeglance',
  win32: 'dist-app/win-unpacked/lifeGLANCE.exe',
  darwin: `dist-app/mac${process.arch === 'arm64' ? '-arm64' : ''}/lifeGLANCE.app/Contents/MacOS/lifeGLANCE`,
}[process.platform]
const executablePath = path.join(root, executable)
if (!existsSync(executablePath)) {
  console.error(`No packaged app at ${executable}. Run: npm run build:electron:dir`)
  process.exit(2)
}

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}
const until = async (read, done, tries = 100) => {
  let value
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, 100))
    value = await read()
    if (done(value)) break
  }
  return value
}

// A fresh profile every run, and never the developer's own: Chromium's
// --user-data-dir is where Electron takes userData from when it is given.
const profile = mkdtempSync(path.join(os.tmpdir(), 'lifeglance-smoke-'))

// --no-sandbox: CI runners (and root in containers) cannot use Chromium's
// setuid sandbox. The shipped app keeps it.
const app = await electron.launch({ executablePath, args: ['--no-sandbox', `--user-data-dir=${profile}`], timeout: 60_000 })
const pageErrors = []
const consoleErrors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  await page.waitForLoadState('load')
  // Loaded again now that the listeners are on, so nothing the page says while
  // it boots (a CSP refusal, an error) is missed.
  await page.reload()
  await page.waitForLoadState('load')
  // The app is up once React has rendered into the root.
  await page.waitForSelector('#root > *', { timeout: 30_000 })

  const url = page.url()
  check(url.startsWith('app://lifeglance/'), `page is on app://lifeglance (${url})`)
  const origin = await page.evaluate(() => window.location.origin)
  check(origin === 'app://lifeglance', `the origin is app://lifeglance (${origin})`)

  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  check(path.resolve(userData).startsWith(path.resolve(profile)), `the run is on its own profile (${userData})`)

  const bridge = await page.evaluate(() => {
    const b = window.lifeGlanceDesktop
    return b ? { platform: b.info?.platform, groups: Object.keys(b).sort() } : null
  })
  const mainPlatform = await app.evaluate(() => process.platform)
  check(bridge?.platform === mainPlatform, `bridge reports the platform (${bridge?.platform})`)
  check(JSON.stringify(bridge?.groups) === JSON.stringify(['icloud', 'info', 'shell']), `bridge exposes its groups (${bridge?.groups})`)
  check(await page.evaluate(() => typeof window.require === 'undefined' && typeof window.process === 'undefined'), 'no Node in the page')

  const classes = await page.evaluate(() => document.documentElement.className)
  check(/\bdesktop\b/.test(classes) && classes.includes(`desktop-${mainPlatform}`), `desktop chrome classes set (${classes})`)

  // indexedDB.databases() lists a database only once its first open has
  // committed, which can trail the first render on a fresh profile.
  const dbs = await until(
    () => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name)),
    (names) => names.includes('lifeglance'),
  )
  check(dbs.includes('lifeglance'), `IndexedDB opened the lifeglance database (${dbs.join(', ')})`)

  // The electron build carries no service worker, and app:// is not registered
  // to allow one, so Chromium refuses the API outright there.
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported'
    if (navigator.serviceWorker.controller) return 'controlled'
    try {
      return `${(await navigator.serviceWorker.getRegistrations()).length} registrations`
    } catch (e) {
      return e instanceof DOMException && e.name === 'InvalidStateError' ? 'refused on this origin' : `error: ${e}`
    }
  })
  check(['unsupported', '0 registrations', 'refused on this origin'].includes(sw), `no service worker (${sw})`)

  // The CSP: everything the app itself loads passed it (its own inline boot
  // scripts, by hash), and a script injected afterwards does not run.
  const cspErrors = consoleErrors.filter((m) => /Content Security Policy/i.test(m))
  check(cspErrors.length === 0, `CSP let the app's own scripts, styles and fonts load${cspErrors.length ? `: ${cspErrors.join(' | ')}` : ''}`)
  check(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), 'index.html\'s boot script ran')
  const csp = await page.evaluate(() => new Promise((resolve) => {
    document.addEventListener('securitypolicyviolation', (e) => resolve(e.violatedDirective), { once: true })
    const s = document.createElement('script')
    s.textContent = 'window.__injected = true'
    document.head.appendChild(s)
    setTimeout(() => resolve(null), 3000)
  }))
  check(/^script-src/.test(csp ?? '') && await page.evaluate(() => window.__injected !== true), `CSP blocks an injected inline script (${csp})`)

  // The theme: the page reports it, and main keeps it for the next launch.
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light') })
  const themeFile = path.join(userData, 'window-theme.json')
  const savedTheme = await until(
    async () => { try { return JSON.parse(readFileSync(themeFile, 'utf-8')) } catch { return null } },
    (saved) => saved?.dark === false,
  )
  check(savedTheme?.dark === false, `the theme reaches the main process (${JSON.stringify(savedTheme)})`)
  check(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource) === 'light', 'the window chrome follows the app\'s theme')
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })

  // The page's log lines land in the log file.
  await page.evaluate(() => window.lifeGlanceDesktop.shell.log('smoke test line'))
  const logFile = path.join(userData, 'lifeglance-startup.log')
  const log = await until(
    async () => { try { return readFileSync(logFile, 'utf-8') } catch { return '' } },
    (text) => text.includes('page: smoke test line'),
  )
  check(log.includes('page: smoke test line'), 'the page\'s log lines reach the log file')
  check(log.includes('main window show (ready-to-show)'), 'the window was shown after its first paint')

  // The wake signal replays visibilitychange, which the page's hooks listen for.
  const wakeSeen = page.evaluate(() => new Promise((resolve) => {
    document.addEventListener('visibilitychange', () => resolve(true), { once: true })
    setTimeout(() => resolve(false), 3000)
  }))
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('shell:wake', 'resume') })
  check(await wakeSeen, 'a wake from the main process reaches the page as visibilitychange')

  // iCloud Drive is macOS's. Elsewhere the page's bridge is null (so the Cloud
  // Sync section and the first-run question never appear), and main answers
  // "not available" to anything that asks anyway.
  const icloud = await page.evaluate(async () => {
    const i = window.lifeGlanceDesktop.icloud
    return { available: await i.available(), read: await i.readFile({ path: 'lifeglance-sync.json' }), write: await i.writeFile({ path: 'smoke.json', text: '{}' }), list: await i.listFiles({ path: '' }) }
  })
  if (mainPlatform === 'darwin') {
    check(typeof icloud.available?.available === 'boolean', `iCloud answers on macOS (available: ${icloud.available?.available})`)
  } else {
    check(icloud.available?.available === false && icloud.read?.kind === 'error' && icloud.write?.ok === false && icloud.list?.names === null,
      `iCloud is not available off macOS (${JSON.stringify(icloud)})`)
  }

  // A link leaves for the browser: no second window, no navigation.
  await app.evaluate(({ shell }) => {
    globalThis.__opened = []
    shell.openExternal = async (target) => { globalThis.__opened.push(target) }
  })
  await page.evaluate(() => {
    window.open('https://www.glance-apps.com/apps/lifeglance', '_blank', 'noopener,noreferrer')
    window.open('vscode://file/etc/passwd', '_blank')
  })
  const opened = await until(() => app.evaluate(() => globalThis.__opened), (list) => list.length > 0)
  check(JSON.stringify(opened) === JSON.stringify(['https://www.glance-apps.com/apps/lifeglance']), `a web link goes to the browser, another app's scheme nowhere (${JSON.stringify(opened)})`)
  check(app.windows().length === 1, 'no second window opened')
  check(page.url() === url, 'the app did not navigate away')

  // What the page may ask the engine for: storage that is not evicted and the
  // screen wake lock (watch mode), but not notifications.
  const granted = await page.evaluate(async () => {
    const out = {}
    try { out.persist = await navigator.storage.persist() } catch (e) { out.persist = String(e) }
    try { const lock = await navigator.wakeLock.request('screen'); out.wakeLock = lock.released === false; await lock.release() } catch (e) { out.wakeLock = String(e) }
    try { out.notifications = await Notification.requestPermission() } catch (e) { out.notifications = String(e) }
    return out
  })
  check(granted.persist === true && granted.wakeLock === true && granted.notifications === 'denied',
    `persistent storage and the wake lock are granted, notifications are not (${JSON.stringify(granted)})`)

  // Export is the web build's: a blob behind an <a download>
  // (src/native/saveFile.js). In the shell that is a download, which Electron
  // answers with a save dialog; here the path is chosen for it.
  const exported = path.join(profile, 'exported-backup.json')
  await app.evaluate(({ session }, savePath) => {
    globalThis.__download = new Promise((resolve) => {
      session.defaultSession.once('will-download', (_event, item) => {
        item.setSavePath(savePath)
        item.once('done', (_e, state) => resolve({ state, name: item.getFilename() }))
      })
    })
  }, exported)
  await page.evaluate(() => {
    const url = URL.createObjectURL(new Blob(['{"smoke":true}'], { type: 'application/json' }))
    const a = document.createElement('a')
    a.download = 'lifeglance-backup.json'
    a.href = url
    document.body.appendChild(a)
    a.click()
    a.remove()
  })
  const download = await Promise.race([
    app.evaluate(() => globalThis.__download),
    new Promise((resolve) => setTimeout(() => resolve({ state: 'timed out' }), 10_000)),
  ])
  const exportedText = existsSync(exported) ? readFileSync(exported, 'utf-8') : null
  check(download.state === 'completed' && download.name === 'lifeglance-backup.json' && exportedText === '{"smoke":true}',
    `an export is saved as a file (${JSON.stringify(download)})`)

  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT })

  check(pageErrors.length === 0, `no uncaught page error${pageErrors.length ? `: ${pageErrors.join(' | ')}` : ''}`)
} catch (err) {
  check(false, `smoke test ran to the end (${err?.stack ?? err})`)
} finally {
  await app.close().catch(() => {})
  rmSync(profile, { recursive: true, force: true })
}

if (consoleErrors.length) console.log(`console errors seen:\n  ${consoleErrors.join('\n  ')}`)
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nDesktop smoke test passed')
