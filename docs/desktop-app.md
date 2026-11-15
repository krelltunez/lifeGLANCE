# Desktop app (Electron)

Status: in development, not released. The shell, iCloud Drive sync on macOS
and unsigned packaging for all three systems are built and tested. What is
left before a release is under [What is next](#what-is-next).

The desktop app is the existing web bundle in an Electron window for macOS,
Windows and Linux. It follows lastGLANCE's desktop app (`krelltunez/lastGLANCE`,
`electron/` and `docs/desktop-app.md`), which follows dayGLANCE's, and it is
much smaller than either:

- one window, and the app quits when it closes (macOS keeps it in the Dock);
- no tray or menu bar popup, no background mode, no reminders, no deep links;
- no MCP server and no Stream Deck listener, so the app opens no port.

What it adds to the web app is **iCloud Drive sync on macOS**: the timeline
stays in step with the iPhone and iPad apps with nothing to set up.

## Running it

| Command | What it does |
|---|---|
| `npm run dev:electron` | Vite on port 5184 with HMR, and Electron pointed at it. After a change under `electron/`, stop it and run it again. |
| `npm run build:electron` | the installers for the host system, in `dist-app/` |
| `npm run build:electron:dir` | the unpacked app only, which is what the smoke test launches |
| `npm run test:electron-smoke` | the smoke test; Linux needs a display (`xvfb-run -a`) |
| `node scripts/gen-desktop-icons.mjs` | regenerates `electron/resources/` from `public/icon-master.svg` |

These need Node 22.12 or later, which is Electron's own requirement. The
Electron binary is downloaded the first time one of them runs, not by
`npm install`, so the web, Docker and phone builds are not slowed by it.

## Layout

| Path | Contents |
|---|---|
| `electron/main.js` | the main process |
| `electron/preload.cjs` | the bridge the page sees |
| `electron/*.js` | one module per concern, each with its vitest test beside it |
| `electron/entitlements.mac.plist`, `electron/resources/` | the macOS entitlements and the icons |
| `electron-builder.config.cjs` | packaging |
| `scripts/codesign-ad-hoc.cjs`, `scripts/notarize.cjs` | the macOS signing hooks |
| `scripts/dev-electron.mjs` | the dev loop |
| `e2e/electron-smoke.mjs` | the smoke test |
| `src/native/desktop.js` | the page's side of the bridge |
| `vite.config.js`, `--mode electron` | the same bundle with no PWA plugin |

The main process is plain ES modules and the preload is CommonJS. Neither is
compiled: there is no TypeScript in this repo and no build step for `electron/`.

## Shell shape

**Plain Electron, not `@capacitor-community/electron`.** In the desktop app
`Capacitor.getPlatform()` reads `'web'` and `Capacitor.isNativePlatform()` is
false, so everything gated on those behaves as the web build does: export is a
download (Electron shows a save dialog), import is a file input, billing is
ungated. A module that needs the shell asks for it explicitly.

### The bridge

The preload exposes one frozen object, `window.lifeGlanceDesktop`, through
`contextBridge`. `src/native/desktop.js` reads it: `desktopBridge()` is the
object, or null on the web and the phones.

| Group | Contents |
|---|---|
| `info` | `{ platform: 'darwin' \| 'win32' \| 'linux' }` |
| `shell` | `setTheme(dark)`, `log(message)`, `onWake(listener)` |
| `icloud` | the iOS `ICloud` plugin's calls: `available`, `readFile`, `writeFile`, `listFiles`, `deleteFile`, `makeDir`, and `onChanged(listener)` for its `changed` event |

`electron/bridgeContract.test.js` holds three things to one list: the methods
`src/native/desktop.js` names, what `preload.cjs` exposes, and the
`ipcMain` handlers in `main.js`. It also checks that every handler answers only
the main window. It reads the source text, as `icloudIosParity.test.js` does for
the iOS plugin, so a method added on one side only fails the suite.

`installDesktopShell()` runs once in `src/main.jsx`, before first paint:

- it adds `html.desktop` and `html.desktop-<platform>`;
- it reports the app's theme, now and on every change;
- it replays the shell's wake signal as `visibilitychange`.

### Origin and storage

- **The origin is `app://lifeglance`, from the first build, and never changes.**
  IndexedDB (the whole timeline) and localStorage are keyed by origin, so a
  later move would orphan them. `file://` is never used. `protocol.handle`
  serves `dist/` through `resolveAppRequest`, with a traversal guard. The app
  has no client-side routes, so anything that is not a file is a 404, never the
  app's HTML.
- **userData is `<appData>/lifeGLANCE`**, whatever the bundle id. The startup
  log, window bounds and theme live there. Chromium's `--user-data-dir` switch
  still wins, which is how the smoke test runs on a profile of its own.
- **No service worker.** The `electron` Vite mode leaves the PWA plugin out,
  and `app://` is not registered to allow workers. The shell replaces the
  bundle whole on an update, so a precache could only serve a stale one.
- **One instance.** A second launch focuses the first. Two would be two writers
  on one database and two sync loops.

### The window

- A standard title bar on every system. The app's theme is its own setting
  (dark until the user picks light), so the shell follows it rather than the
  OS: `nativeTheme.themeSource` for the title bar and menus, and the window's
  background color before the page paints. The page reports the theme; main
  keeps it in `window-theme.json` for the next launch.
- Size, position and the maximized state persist. A position left on a display
  that is gone is dropped.
- The window is shown after its first paint, with a 10 s fallback so a renderer
  that never paints still leaves a window to report.
- Windows and Linux hide the menu bar until Alt is pressed. The menu
  (`applicationMenu.js`) is the standard roles and one Help item; Electron's
  default menu links to electronjs.org.
- A machine that wakes, or a screen that unlocks, sends the page a wake signal.
  The page's foreground work hangs off `visibilitychange`, which a window left
  up across a sleep never sends.

### Hardening

- `contextIsolation` on, `nodeIntegration` off, `sandbox` on. The preload may
  require only `electron`.
- Every IPC handler checks that the sender is the main window.
- DevTools are off in packaged builds. The startup log
  (`lifeglance-startup.log` in userData, bounded) is what a report from a real
  machine is traced with. The page adds lines to it through `shell.log`: each
  file-sync outcome when it changes (`[icloud] merged applied`,
  `[icloud] skipped downloading`, `[icloud] not available`), at most 500 lines a
  session.
- Links leave for the browser or mail client: `http`, `https` and `mailto`
  only. A milestone's link can arrive from another device, so every other
  scheme is dropped. The window never navigates off its origin and never opens
  a second window.
- The page is granted fullscreen and the screen wake lock (watch mode),
  clipboard writes and persistent storage, and nothing else: no camera,
  microphone, location or notifications.
- The CSP is set by main on the document it serves, since `index.html` is
  shared with the web and the phones:
  - `script-src 'self'` plus the hashes of `index.html`'s two inline boot
    scripts, computed from the built file at startup. No other inline script
    and no eval.
  - Styles and fonts allow Google Fonts, the typeface `index.html` links.
  - `img-src` and `media-src` allow `data:` and `blob:`, for decrypted photos,
    video and audio.
  - `connect-src 'self' https: http:`. The page still makes its own requests,
    as the web build does. This narrows to `'self'` when sync moves into the
    main process (see below).
- A renderer crash is recovered by a ladder: reload, then recreate the window,
  then stop (`rendererRecovery.js`).

## iCloud Drive on macOS

The iOS tier runs as it is: `src/sync/icloud.js`, `useSnapshotFileSync`, the
seed guard, the preference that is on by default, and the first-run question
(`docs/icloud-sync.md`). The desktop supplies the plugin's calls, and
`isICloudAvailable()` becomes "iOS, or the desktop app on macOS".

**Containers.** Both are plain folders under `~/Library/Mobile Documents/`:

| Container | Folder | Contents |
|---|---|---|
| `own` | `iCloud~com~lifeglance/Documents/` | `lifeglance-sync.json` |
| `dayglance` | `iCloud~com~dayglance/Documents/` | `GLANCE/events/`, for intents |

**No helper binary and no entitlement** on the Developer ID build: the app is
not sandboxed and reads the folders as files (`electron/icloud.js`). A Mac App
Store build would carry the iCloud entitlements in the main process and read
the real home directory by stripping `/Library/Containers/<id>/Data` from the
sandbox's one, which `realHomeDir` already does.

**Availability is the container folder existing.** With no native API call the
Mac cannot create the container. iCloud on the Mac therefore lights up once the
iOS app has used iCloud on that Apple ID, which is who this is for.
`available()` is asked every cycle, so it appears by itself once the folder
syncs down. Nothing here creates it.

**Reads** answer the shared classification (absent, downloading, error, text):

- A `.name.icloud` placeholder reads as `downloading`, and `listFiles` names it
  by its real name, so a caller waits for it.
- An `EDEADLK`, `ETIMEDOUT` or `EAGAIN` while macOS fetches a dataless file
  also reads as `downloading`. Since macOS 14, iCloud Drive evicts files in
  place and a read faults them in.
- While a read of a file has not returned, another read of it answers
  `downloading`, so the 15 s poll never piles reads up.
- A cloud-only file is also asked for with `brctl download`, at most once a
  minute per file. This is best-effort.

**Freshness.** iOS serves a file only once iCloud reports it current, an answer
only Apple's API gives. The desktop serves the local bytes as they are, and
`allowStale` changes nothing. That is safe for this data: every device keeps
its own copy and the cycle merges row by row by edit stamp, so reading an older
file only means this device catches up on its next cycle. It cannot erase
another device's edits.

**Writes** are in place, not by temp file and rename: a rename replaces the
inode and drops the extended attributes that make the iCloud daemon queue the
upload. Each write is a full rewrite with fsync, and the cycle's seed guard
makes a torn read retry instead of applying. The transport's `atomic` flag is
ignored for that reason.

**Changes.** `fs.watch` on the `own` container's `Documents/`, for the sync
file, with a 1 s debounce and a 2 s suppression of the app's own writes, posts
`changed`, which runs a cycle at once. It waits for the folder to appear and
re-attaches when iCloud recreates it. The 15 s poll is still the backstop.

**A first launch waits for iCloud's listing.** On a Mac that has never read
the snapshot, a missing sync file is treated as one iCloud has not listed yet
(`downloading`) for 10 minutes, the shared eviction window, before it is seeded
(`absentMayBePending` on the bridge, `ICLOUD_FIRST_SYNC_GRACE_MS` in
`src/sync/icloud.js`). The container folder exists only once the iOS app has
used iCloud, and that app writes the file on its first cycle, so "missing" on a
Mac's first launch almost always means "not downloaded yet". Without the wait,
lastGLANCE's first real Mac launch seeded its own file under the name and
iCloud kept the iPhone's as a conflict copy.

**Restoring leaves onboarding.** The first-run question is answered on a fresh
install, so over the onboarding screen. Once "Restore from iCloud" has brought
the timeline in, the app shows it (`App.jsx`). This is shared code, so the iOS
app does the same.

**Intents.** The iCloud intents transport (`src/lib/intentsICloudTransport.js`)
reads and writes the `dayglance` container through the same calls, so it is
offered in the dayGLANCE integration settings on a Mac as it is on iOS. It is
still opt-in.

**Tested without a Mac.**

- `electron/icloud.test.js` runs the store over real files in a temp home.
- `src/sync/icloudDesktop.scenarios.test.js` runs the real transport, cycle and
  merge over that store, through the same adapter and bridge the app builds on
  a Mac: a Mac and an iPhone merging both ways, an edit written in place, and a
  Mac's first launch (an empty folder, the iPhone's file arriving later,
  nothing written by the Mac in between, then the question).
- By hand, on Linux, with a copy of the shell patched to answer as macOS and a
  fake `~/Library/Mobile Documents`: the first-run question, the restore, and a
  change written by another device appearing about a second later.

**Verify on a real Mac before release.** None of this can run in CI:

- the dataless-file read path, a read faulting in an evicted file;
- that macOS lets the build read `iCloud~com~lifeglance` without a prompt or a
  refusal. A build signed by the same team as the iOS app is expected to be
  let in, as dayGLANCE's and lastGLANCE's are. An ad-hoc build may be asked or
  refused, in which case the folder reads as not there and iCloud stays quiet;
- the watcher seeing a change that arrives from the iPhone;
- the log lines above, which say what each cycle did.

## Packaging

**Identity.** `appId` is `com.lifeglance.app`, which matches Android.
`productName` is lifeGLANCE. A Mac App Store build would use `com.lifeglance`,
the iOS bundle id, for Universal Purchase.

**Targets.**

| System | Targets | Notes |
|---|---|---|
| macOS | `dmg` and `zip`, x64 and arm64 | Developer ID when `CSC_LINK` is set, ad-hoc otherwise |
| Windows | `nsis` | unsigned, so SmartScreen warns on first run |
| Linux | `AppImage` and `deb`, x64 and arm64 | explicit arch list; arch in every AppImage name |

**Runtime dependencies.** The package ships no `node_modules`: the renderer is
one Vite bundle and main imports only Electron and Node.
`electron/builderConfig.test.js` holds that.

**Signing.** `scripts/codesign-ad-hoc.cjs` (afterPack) and
`scripts/notarize.cjs` (afterSign), driven by `CSC_LINK`, `CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Hardened Runtime
is on for a Developer ID build.

**Versioning.** `package.json` is the single source.

**CI.**

- `desktop.yml` runs on changes that can affect the desktop app: the shell's
  tests, then the unpacked Linux app under xvfb with the smoke test.
- `release-desktop.yml` builds the installers for all three systems. It runs
  by hand only for now and attaches nothing to a release. Its header says what
  to change when the app is ready to ship with a tag.

## Tests

- **Unit tests**, beside each module in `electron/`, run with the rest of the
  suite (`npm test`).
- **The smoke test** (`e2e/electron-smoke.mjs`) launches the packaged app on a
  fresh profile and checks what no unit test can see: the origin, the bridge,
  IndexedDB opening there, no service worker, the CSP letting the app's own
  scripts through and blocking an injected one, the theme and the log reaching
  main, the wake signal, iCloud answering "not available" off macOS, which
  permissions are granted, a link leaving for the browser, and an export being
  saved as a file.

## What is next

In rough order:

1. **Sync through the main process.** WebDAV does not work in the desktop app
   yet: there is no proxy and a WebDAV server sends no CORS headers. GLANCEvault
   works only if the server allows the `app://lifeglance` origin. lastGLANCE's
   answer is the one to take: every request goes through main (`net.fetch`), the
   engine's `electronProxyFetch` slot and `nativeVaultFetchImpl()` gain a
   desktop branch, private addresses need a grant, GLANCEvault's push is read in
   main, and `connect-src` narrows to `'self'`. The vault's blob media needs a
   binary body on that path, which lastGLANCE's does not have. The image export
   fetches the typeface to embed it (`TimelineView.jsx`), so the font hosts
   stay in `connect-src` unless the font is bundled first.
2. **Secure storage** over Electron's `safeStorage`, behind
   `src/native/secureStore.js`. Until then credentials are in web storage, as
   on the web.
3. **Direct Access** on a real folder, the Android folder contract.
4. **Release.** A real-Mac pass (above), the Developer ID secrets on this repo,
   a tag trigger for `release-desktop.yml`, an "update available" notice, and
   the README's download section.
5. **Mac App Store build**, if wanted: the sandbox entitlements with both
   iCloud containers, a provisioning profile, and the paywall through
   `@glance-apps/billing`'s Electron half. Direct builds stay free, like the
   web app and the sideload APK.

Smaller things:

- The menu is in English on Windows and Linux. Translating it needs a `menu`
  block in every locale, pushed from the page.
- The typeface comes from Google Fonts, as on the web, so a first launch with
  no network falls back to the system monospace. Bundling it would fix that.
- A sync writer on the desktop is labelled "web" in the Lives sheet
  (`writerStamp.js` reads Capacitor's platform).
- macOS could hide the title bar (`hiddenInset`) once the header leaves room
  for the traffic lights.
