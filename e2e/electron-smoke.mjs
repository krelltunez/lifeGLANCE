#!/usr/bin/env node
// Desktop smoke test (docs/desktop-app.md, "Tests"): launch the PACKAGED app
// (electron-builder --dir output, so app.isPackaged is true and the real
// app:// protocol serves the bundle) on a fresh profile, and check what no unit
// test can see:
//
//   - the page is on app://lifeglance, the origin the data lives under;
//   - the preload exposed the bridge, with this build's version and platform;
//   - the bundled typeface loads, with no request outside the app;
//   - the desktop chrome classes are set;
//   - the app rendered, and IndexedDB opened the `lifeglance` database there;
//   - no service worker registered;
//   - the CSP lets everything the app loads through (index.html's boot scripts
//     by hash) and blocks an injected script;
//   - the page's theme reaches the main process, for the next launch's window;
//   - the page's log lines reach the log file;
//   - the CSP blocks a network request made by the page itself;
//   - requests go through the main process: a server on a private address is
//     refused until granted, then reached, as text and as bytes, and the grant
//     can be revoked;
//   - the app's own WebDAV path (the sync engine's connection test) and its
//     GLANCEvault client reach that server through the main process;
//   - GLANCEvault's real-time push is read by the main process and relayed;
//   - secure storage round-trips where the OS protects secrets;
//   - Direct Access: a picked folder, files by path, confined to it;
//   - the application menu takes the page's language;
//   - the update check answers;
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
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'))

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
    return b ? { info: { ...b.info }, groups: Object.keys(b).sort() } : null
  })
  const info = bridge?.info
  const mainPlatform = await app.evaluate(() => process.platform)
  check(info?.platform === mainPlatform, `bridge reports the platform (${info?.platform})`)
  check(info?.version === version, `bridge reports version ${version} (${info?.version})`)
  check(info?.isMAS === false, 'bridge reports a build that is not the Mac App Store one')
  check(JSON.stringify(bridge?.groups) === JSON.stringify(['directAccess', 'http', 'icloud', 'info', 'secureStore', 'shell', 'vaultSse']), `bridge exposes its groups (${bridge?.groups})`)
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

  // The page makes no network request of its own (connect-src 'self').
  const blockedFetch = await page.evaluate(() => new Promise((resolve) => {
    document.addEventListener('securitypolicyviolation', (e) => resolve(e.violatedDirective), { once: true })
    fetch('https://example.com/').catch(() => {})
    setTimeout(() => resolve(null), 5000)
  }))
  check(blockedFetch === 'connect-src', `CSP blocks a request made by the page itself (${blockedFetch})`)

  // The typeface is in the bundle: it loads with the page, from the app's own origin.
  const font = await page.evaluate(async () => {
    await document.fonts.load('16px "Courier Prime"')
    const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Courier Prime')
    return {
      loaded: document.fonts.check('16px "Courier Prime"') && faces.some((f) => f.status === 'loaded'),
      linked: !!document.querySelector('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]'),
    }
  })
  check(font.loaded && !font.linked, `the bundled typeface loads, and nothing links Google Fonts (${JSON.stringify(font)})`)

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
  // The page can be up and answering before its first frame is painted, so
  // wait for the line: within the 10 s after which main shows the window anyway.
  const shown = await until(
    async () => { try { return /main window show \(([^)]+)\)/.exec(readFileSync(logFile, 'utf-8'))?.[1] ?? null } catch { return null } },
    (why) => why !== null,
    150,
  )
  check(shown === 'ready-to-show', `the window was shown after its first paint (${shown})`)

  // The wake signal replays visibilitychange, which the page's hooks listen
  // for. The listener is in place before main sends the signal.
  await page.evaluate(() => {
    window.__wakeSeen = new Promise((resolve) => {
      document.addEventListener('visibilitychange', () => resolve(true), { once: true })
      setTimeout(() => resolve(false), 5000)
    })
  })
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('shell:wake', 'resume') })
  check(await page.evaluate(() => window.__wakeSeen), 'a wake from the main process reaches the page as visibilitychange')

  // The network path (docs/desktop-app.md, "Sync through the main process"),
  // against a local server: 127.0.0.1 is a private address, so it needs a
  // grant. The native dialog is answered "Allow" by replacing showMessageBox
  // in the main process.
  const hits = []
  const blob = Buffer.from([0, 159, 146, 150, 255, 254, 10, 13])
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      if (req.url.startsWith('/events')) {
        // A heartbeat, then one event, then held open like a real vault.
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(': heartbeat\n\n')
        res.write('data: {"seq":42}\n\n')
        return
      }
      if (req.url.startsWith('/salt/')) {
        // GLANCEvault's salt endpoint: reachable and authorised, nothing set up yet.
        res.writeHead(req.headers.authorization === 'Bearer smoke-token' ? 404 : 401, { 'content-type': 'application/json' })
        return res.end('{}')
      }
      if (req.url === '/blob' && req.method === 'PUT') {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ received: [...Buffer.concat(chunks)] }))
      }
      if (req.url === '/blob') {
        res.writeHead(206, { 'content-type': 'application/octet-stream', 'content-range': `bytes 0-${blob.length - 1}/${blob.length}` })
        return res.end(blob)
      }
      // A WebDAV collection: it exists, and lists as empty.
      res.writeHead(req.method === 'PROPFIND' ? 207 : req.method === 'MKCOL' ? 405 : 200, { ETag: 'W/"abc-gzip"', 'content-type': 'text/xml' })
      res.end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"/>')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const serverOrigin = `http://127.0.0.1:${server.address().port}`
  const target = `${serverOrigin}/dav/`
  try {
    const call = (fn, ...args) => page.evaluate(([f, a]) => window.lifeGlanceDesktop.http[f](...a), [fn, args])
    const inspected = await call('inspect', target)
    const refused = await call('request', 'PROPFIND', target, { Depth: '0' }, null)
    check(inspected?.blocked === true && inspected?.canGrant === true && refused?.error === 'Private/reserved address' && hits.length === 0,
      `a private address is refused before any request (${JSON.stringify(refused)})`)
    await app.evaluate(({ dialog }) => {
      globalThis.__dialogs = []
      dialog.showMessageBox = async (...args) => { globalThis.__dialogs.push(args.at(-1)); return { response: 1, checkboxChecked: false } }
    })

    // The app's own code takes this road. In Cloud Sync, the sync engine's
    // WebDAV connection test is refused before the server is contacted, says
    // why, and offers the permission; once allowed it runs again and reaches
    // the server, with no proxy and no CORS anywhere.
    await page.getByText('skip', { exact: true }).click()
    await page.waitForSelector('.timeline-header')
    await page.getByText('sync', { exact: true }).click()
    const sheet = page.locator('.sheet')
    await sheet.waitFor()
    await sheet.locator('select').first().selectOption('webdav')
    await sheet.locator('input[type=url]').first().fill(target)
    await sheet.getByPlaceholder('your username').fill('smoke')
    await sheet.getByText('test connection', { exact: true }).click()
    const allow = sheet.getByText('Allow this address…', { exact: true })
    await allow.waitFor({ timeout: 10_000 })
    const refusedText = await sheet.innerText()
    check(refusedText.includes(`${serverOrigin} is on a private network`) && hits.length === 0,
      'Cloud Sync says a private server needs permission, before contacting it')
    await allow.click()
    await sheet.getByText('Connection successful.', { exact: true }).waitFor({ timeout: 15_000 }).catch(() => {})
    const dialogs = await app.evaluate(() => globalThis.__dialogs)
    check(dialogs.length === 1 && dialogs[0].message.includes('Allow lifeGLANCE to connect to this address?') && dialogs[0].message.includes(serverOrigin) && dialogs[0].detail.includes('127.0.0.1'),
      'the permission dialog shows the page\'s wording, and the origin and address from the main process')
    const webdavHit = hits.find((h) => h.includes('/dav/'))
    check((await sheet.innerText()).includes('Connection successful.') && !!webdavHit,
      `once allowed, the WebDAV connection test reaches the server (${hits.join(', ')})`)
    check((await sheet.innerText()).includes('Allowed private addresses'), 'the allowed address is listed in Cloud Sync')

    // GLANCEvault, the same way: the app's vault client verifies the account.
    await sheet.locator('label', { hasText: 'Enable database sync' }).locator('input[type=checkbox]').check()
    await sheet.getByPlaceholder('https://vault.example.com').fill(serverOrigin)
    await sheet.getByPlaceholder('Paste your device token').fill('smoke-token')
    await sheet.getByPlaceholder('Household account ID').fill('household-1')
    await sheet.getByText('Verify connection', { exact: true }).click()
    await sheet.getByText('Connected, but this account has not been initialized yet', { exact: false }).waitFor({ timeout: 15_000 }).catch(() => {})
    check((await sheet.innerText()).includes('Connected, but this account has not been initialized yet') && hits.includes('GET /salt/household-1'),
      `the vault client reaches the server through the main process (${hits.filter((h) => h.includes('salt')).join(', ')})`)
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'detached' })

    // The bridge itself: text, then bytes both ways for GLANCEvault's media.
    const reached = await call('request', 'PROPFIND', target, { Depth: '0' }, null)
    check(reached?.status === 207 && reached.body.includes('multistatus') && reached.headers.etag === 'W/"abc-gzip"' && hits.at(-1) === 'PROPFIND /dav/',
      `a granted request answers with status, body and headers (${reached?.status})`)
    const listed = await call('grants')
    check(listed.length === 1 && listed[0].origin === serverOrigin, `the grant is listed (${JSON.stringify(listed.map((g) => g.origin))})`)
    const bytes = await page.evaluate(async ([url]) => {
      const h = window.lifeGlanceDesktop.http
      const up = await h.request('PUT', url, { 'Content-Type': 'application/octet-stream' }, new Uint8Array([0, 255, 128, 7]))
      const down = await h.request('GET', url, { Range: 'bytes=0-7' }, null, { binary: true })
      return { up: JSON.parse(up.body).received, down: [...down.body], isBytes: down.body instanceof Uint8Array, status: down.status, range: down.headers['content-range'] }
    }, [`${serverOrigin}/blob`])
    check(JSON.stringify(bytes.up) === '[0,255,128,7]' && bytes.isBytes && JSON.stringify(bytes.down) === JSON.stringify([...blob]) && bytes.status === 206 && bytes.range === 'bytes 0-7/8',
      `bytes cross the bridge unchanged, both ways (${JSON.stringify(bytes)})`)

    // GLANCEvault's real-time push, read by the main process and relayed.
    const sse = await page.evaluate(([vaultUrl]) => new Promise((resolve) => {
      const seen = []
      const stop = window.lifeGlanceDesktop.vaultSse.onMessage((m) => {
        seen.push(m)
        if (m.type === 'frame') { stop(); void window.lifeGlanceDesktop.vaultSse.stop(); resolve(seen) }
      })
      void window.lifeGlanceDesktop.vaultSse.start({ vaultUrl, vaultToken: 'smoke-token', accountId: 'a1' })
      setTimeout(() => { stop(); resolve(seen) }, 8000)
    }), [serverOrigin])
    const types = sse.map((m) => m.type).join(',')
    check(types === 'open,frame' && sse[1].block === 'data: {"seq":42}' && hits.includes('GET /events?accountId=a1'),
      `vault live updates reach the page (${types})`)

    await call('revoke', serverOrigin)
    const count = hits.length
    const again = await call('request', 'GET', target, {}, null)
    check(again?.error === 'Private/reserved address' && hits.length === count, 'a revoked grant refuses again')
  } finally {
    server.closeAllConnections?.()
    server.close()
  }

  // Secure storage: a round trip where the OS protects secrets; elsewhere
  // (Linux without a keyring, as on CI) the app says so and keeps web storage.
  if (info?.secureStorage === true) {
    const stored = await page.evaluate(async () => {
      const s = window.lifeGlanceDesktop.secureStore
      await s.set({ key: 'smoke-test', value: 'v' })
      const { value } = await s.get({ key: 'smoke-test' })
      await s.delete({ key: 'smoke-test' })
      return [value, (await s.get({ key: 'smoke-test' })).value]
    })
    check(stored[0] === 'v' && stored[1] === null, 'secure storage round-trips')
    check(!readFileSync(path.join(userData, 'secure-store.json'), 'utf-8').includes('"v"'), 'the stored value is not on disk in the clear')
  } else {
    check(info?.secureStorage === false, `secure storage reported unavailable here (${info?.secureStorage})`)
  }

  // Direct Access: a folder picked through the native dialog (answered here
  // with a temp folder), files by path inside it, nothing outside it, and a
  // change made by another program reported.
  const folder = mkdtempSync(path.join(os.tmpdir(), 'lifeglance-smoke-folder-'))
  try {
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir], bookmarks: [] }) }, folder)
    const da = await page.evaluate(async () => {
      const d = window.lifeGlanceDesktop.directAccess
      const picked = await d.pickFolder()
      const wrote = await d.writeFile({ rel: 'GLANCE/users/glance-users.json', text: '{"users":[]}' })
      const read = await d.readFile({ rel: 'GLANCE/users/glance-users.json' })
      const escaped = await d.writeFile({ rel: '../escaped.json', text: 'x' })
      const snapshot = await d.write({ text: '{"mine":true}' })
      return { picked: picked.configured && picked.reachable, wrote: wrote.ok, read: read.text, escaped: escaped.ok, snapshot: snapshot.ok }
    })
    check(da.picked && da.wrote && da.read === '{"users":[]}' && da.escaped === false && da.snapshot
      && existsSync(path.join(folder, 'GLANCE/users/glance-users.json')) && readFileSync(path.join(folder, 'lifeglance-sync.json'), 'utf-8') === '{"mine":true}'
      && !existsSync(path.join(folder, '..', 'escaped.json')),
      `direct access: pick, the snapshot, files by path, confined (${JSON.stringify(da)})`)
    const disconnected = await page.evaluate(async () => {
      const d = window.lifeGlanceDesktop.directAccess
      await d.disconnect()
      return (await d.status()).configured
    })
    check(disconnected === false, 'direct access: disconnect forgets the folder')
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }

  // The application menu takes the page's language: English at launch here,
  // and German once the page sends German labels.
  const menuTop = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((item) => item.label))
  const english = await menuTop()
  check(english.includes('Edit') && english.includes('lifeGLANCE Help'), `the menu is in the page's language, English here (${english.join(', ')})`)
  const menuOf = (lng) => JSON.parse(readFileSync(path.join(root, 'src/locales', lng, 'desktop.json'), 'utf-8')).menu
  await page.evaluate((labels) => window.lifeGlanceDesktop.shell.setMenuLabels(labels), menuOf('de'))
  const german = await until(menuTop, (labels) => labels.includes('Bearbeiten'))
  check(german.includes('Bearbeiten') && german.includes('Ansicht') && !german.includes('Edit'), `the menu follows a language change (${german.join(', ')})`)
  await page.evaluate((labels) => window.lifeGlanceDesktop.shell.setMenuLabels(labels), menuOf('en'))

  // The update check answers: null, or a release this OS can install. Never a throw.
  const update = await page.evaluate(() => window.lifeGlanceDesktop.shell.latestRelease())
  check(update === null || (typeof update?.version === 'string' && /^https:\/\/github\.com\//.test(update.url)), `the update check answers (${JSON.stringify(update)})`)

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
