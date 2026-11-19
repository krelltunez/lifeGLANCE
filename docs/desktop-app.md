# Desktop app (Electron)

Status: built, not yet released. The shell, sync through the main process
(WebDAV, GLANCEvault and its real-time push), iCloud Drive on macOS, secure
storage, Direct Access, the update notice, packaging for all three systems and
the Mac App Store build with its purchases are in place and tested. What is
left is under [What is next](#what-is-next).

The desktop app is the existing web bundle in an Electron window for macOS,
Windows and Linux. It follows lastGLANCE's desktop app (`krelltunez/lastGLANCE`,
`electron/` and `docs/desktop-app.md`), which follows dayGLANCE's, and it is
much smaller than either:

- one window, and the app quits when it closes (macOS keeps it in the Dock);
- no tray or menu bar popup, no background mode, no reminders, no deep links;
- no MCP server and no Stream Deck listener, so the app opens no port.

Everything that syncs on the web or the phones syncs here, with no proxy and no
CORS setup, and on a Mac the timeline stays in step with the iPhone and iPad
apps through iCloud with nothing to set up.

## Running it

| Command | What it does |
|---|---|
| `npm run dev:electron` | Vite on port 5184 with HMR, and Electron pointed at it. After a change under `electron/`, stop it and run it again. |
| `npm run build:electron` | the installers for the host system, in `dist-app/` |
| `npm run build:electron:dir` | the unpacked app only, which is what the smoke test launches |
| `npm run build:electron:mas` | the Mac App Store `.pkg`, on a Mac with the certificates and the profile ([The Mac App Store build](#the-mac-app-store-build)) |
| `npm run test:electron-smoke` | the smoke test; Linux needs a display (`xvfb-run -a`) |
| `node scripts/gen-desktop-icons.mjs` | regenerates `electron/resources/` from `public/icon-master.svg` |

These need Node 22.12 or later, which is Electron's own requirement. The
Electron binary is downloaded the first time one of them runs, not by
`npm install`, so the web, Docker and phone builds are not slowed by it.

The dev loop loads the page from Vite, which serves no CSP and links the
typeface from Google Fonts as the web build does. The packaged app is the one
with the policy and the bundled font, and the one the smoke test checks.

## Layout

| Path | Contents |
|---|---|
| `electron/main.js` | the main process |
| `electron/preload.cjs` | the bridge the page sees |
| `electron/*.js` | one module per concern, each with its vitest test beside it |
| `electron/entitlements.mac.plist`, `electron/resources/` | the macOS entitlements and the icons |
| `electron/entitlements.mas.plist`, `electron/entitlements.mas.inherit.plist` | the Mac App Store build's sandbox entitlements, for the app and for Electron's helpers |
| `electron/billingConfig.js` | the store values the Mac App Store build sells with |
| `electron-builder.config.cjs` | packaging |
| `scripts/codesign-ad-hoc.cjs`, `scripts/notarize.cjs` | the macOS signing hooks |
| `scripts/dev-electron.mjs` | the dev loop |
| `e2e/electron-smoke.mjs` | the smoke test |
| `src/native/desktop.js` | the page's side of the bridge |
| `src/locales/<lng>/desktop.json` | the desktop app's own strings |
| `vite.config.js`, `--mode electron` | the same bundle with no PWA plugin, and the typeface bundled |

The main process is plain ES modules and the preload is CommonJS. Neither is
compiled: there is no TypeScript in this repo and no build step for `electron/`.
Most modules come from lastGLANCE's TypeScript ones with the types removed; each
says so at its top.

## Shell shape

**Plain Electron, not `@capacitor-community/electron`.** In the desktop app
`Capacitor.getPlatform()` reads `'web'` and `Capacitor.isNativePlatform()` is
false, so everything gated on those behaves as the web build does: export is a
download (Electron shows a save dialog), import is a file input, billing is
ungated (except on the Mac App Store build, which [Billing](#billing) covers).
A module that needs the shell asks for it explicitly, and each one that does is
named below.

### The bridge

The preload exposes one frozen object, `window.lifeGlanceDesktop`, through
`contextBridge`. `src/native/desktop.js` reads it: `desktopBridge()` is the
object, or null on the web and the phones. Its groups mirror the plugin
contracts the app already has, so the existing wrappers take the desktop
implementation with a small adapter each.

| Group | Contents | Used by |
|---|---|---|
| `info` | `platform`, `version`, `isMAS`, `secureStorage` | `desktop.js` |
| `shell` | `setTheme`, `setMenuLabels`, `log`, `latestRelease`, `onWake`, `onFullscreen` | `desktop.js`, `useUpdateNotice.js` |
| `http` | `request(method, url, headers, body, options)`; `inspect`, `grant`, `grants`, `revoke` | `sync/nativeHttp.js`, `sync/nativeVaultFetch.js`, `sync/privateAddress.js` |
| `vaultSse` | the `VaultSse` plugin's `start` and `stop`, and `onMessage` | `native/vaultSse.js` |
| `secureStore` | the `SecureStore` plugin's `get`, `set`, `delete` | `native/secureStore.js` |
| `directAccess` | the Android folder contract, and `onChanged` | `native/directAccess.js` |
| `icloud` | the iOS `ICloud` plugin's calls, and `onChanged` | `native/icloud.js` |
| `billing` | `@glance-apps/billing`'s `ElectronBillingApi`: status, purchase, restore, prices, and the two events | `billing/billing.js` |

`electron/bridgeContract.test.js` holds three things to one list: the methods
`src/native/desktop.js` names, what `preload.cjs` exposes, and the IPC handlers
in the main process (the billing package's main half among them, since it
registers the `billing` group's channels itself). It also checks that every
handler in `main.js` answers only the main window. It reads the source text, as
`icloudIosParity.test.js` does for the iOS plugin, so a method added on one
side only fails the suite.

`installDesktopShell()` runs once in `src/main.jsx`, before first paint:

- it adds `html.desktop` and `html.desktop-<platform>`;
- it reports the app's theme, now and on every change;
- it replays the shell's wake signal as `visibilitychange`;
- it marks native fullscreen with `html.desktop-fullscreen`.

### Origin and storage

- **The origin is `app://lifeglance`, from the first build, and never changes.**
  IndexedDB (the whole timeline) and localStorage are keyed by origin, so a
  later move would orphan them. `file://` is never used. `protocol.handle`
  serves `dist/` through `resolveAppRequest`, with a traversal guard. The app
  has no client-side routes, so anything that is not a file is a 404, never the
  app's HTML.
- **userData is `<appData>/lifeGLANCE`**, whatever the bundle id. The startup
  log, window bounds and theme, the granted addresses, the secure store and the
  Direct Access folder live there. Chromium's `--user-data-dir` switch still
  wins, which is how the smoke test runs on a profile of its own.
- **No service worker.** The `electron` Vite mode leaves the PWA plugin out,
  and `app://` is not registered to allow workers. The shell replaces the
  bundle whole on an update, so a precache could only serve a stale one.
- **One instance.** A second launch focuses the first. Two would be two writers
  on one database and two sync loops.

### The window

- **macOS has no title bar** (`titleBarStyle: 'hiddenInset'`). The page keeps a
  28 px strip of its own background at the top (`html.desktop-darwin` in
  `src/index.css`): the traffic lights sit in it and the window is dragged by
  it. The app's layout starts below it, and so do the full-window overlays, so
  nothing clickable is ever under the strip (Chromium resolves drag regions
  without regard to stacking). The strip goes away in fullscreen, native or the
  page's own (watch mode), where macOS hides the traffic lights.
- **Windows and Linux keep the native frame**, and hide the menu bar until Alt
  is pressed.
- The app's theme is its own setting (dark until the user picks light), so the
  shell follows it rather than the OS: `nativeTheme.themeSource`, and the
  window's background color before the page paints. The page reports the theme;
  main keeps it in `window-theme.json` for the next launch.
- Size, position and the maximized state persist. A position left on a display
  that is gone is dropped.
- The window is shown after its first paint, with a 10 s fallback so a renderer
  that never paints still leaves a window to report.
- **The menu speaks the app's language** (`applicationMenu.js`). The page
  pushes the `menu` block of `desktop.json`, on every platform, since
  Electron's own role labels are English everywhere. Until a complete set
  arrives the menu is in English. It is the standard items and one Help item;
  Electron's default menu links to electronjs.org.
- A machine that wakes, or a screen that unlocks, sends the page a wake signal.
  The page's foreground work hangs off `visibilitychange`, which a window left
  up across a sleep never sends.

### The typeface

The web build links Courier Prime from Google Fonts and the service worker
caches it. The desktop app has no service worker and must open with no network,
so its build carries the font: `appFontsPlugin` in `vite.config.js` takes the
Google links out of `index.html` and makes `virtual:app-fonts` the
`@font-face` rules of `@fontsource/courier-prime`. In every other build that
module is empty. The image export, which embeds the typeface in the picture,
reads the bundled faces from the page's own stylesheets there
(`embeddedFontFaces` in `exportImageHelpers.js`).

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
  - `connect-src 'self'` (and `data:`, `blob:`, the page reading back what it
    made). The page makes no network request of its own. This is also a test of
    the next section: a fetch site that was missed fails loudly instead of
    meeting a server's CORS rules.
  - Styles and fonts from the bundle only.
  - `img-src` and `media-src` allow `data:` and `blob:`, for decrypted photos,
    video and audio.
- A renderer crash is recovered by a ladder: reload, then recreate the window,
  then stop (`rendererRecovery.js`).

## Sync through the main process

**Every request to a sync server is made by the main process.** WebDAV,
GLANCEvault and intents traffic goes through `bridge.http`, which is
`net.fetch` (`electron/httpProxy.js`) with:

- a 30 s timeout, or 2 minutes for a request that carries bytes;
- manual redirects, re-checked on every hop, with `Authorization`, `Cookie`
  and `Proxy-Authorization` dropped on a redirect to another origin;
- methods including PROPFIND and MKCOL;
- text or bytes in either direction. GLANCEvault's media goes up and down as
  `Uint8Array`, which crosses IPC as it is.

A request that got no response (refused, timed out, network failure) comes back
as an error, not a made-up HTTP status, and the page throws it, as Capacitor's
native HTTP does on the phones.

This removes CORS and the WebDAV proxy from the picture. A self-hosted vault or
Nextcloud needs no `app://lifeglance` entry in its allowed origins.

**Wiring.** `hasNativeHttp()` in `src/sync/nativeHttp.js` is the question every
WebDAV and vault call site asks: a Capacitor shell, or the desktop app.
`isNativePlatform()` stays the Capacitor-shell question, which export and the
cleartext-`http://` refusal still ask.

| Call site | Desktop path |
|---|---|
| the WebDAV engine (`sync/engine.js`, `electronProxyFetch`) | `nativeWebdavFetch` |
| Cloud Sync's folder creation, the intents WebDAV transport and its test | `nativeRequest`, `nativeWebdavResponse` |
| the vault database engine (`sync/dbSync.js`) | `desktopVaultFetchImpl()` |
| vault setup, the roster, vault intents, media (`blobTransport.js`) | `nativeVaultFetchImpl()` |

**Real-time push** also runs in main. `bridge.vaultSse` reads GLANCEvault's
`/events` stream over `net.fetch` (`electron/vaultSse.js`) and relays the same
messages the phone shells do, so `vaultEventStream.js` takes its
`'native-bridge'` road.

**Servers on a private network.** `proxyUrlPolicy.js` is dayGLANCE's policy,
held to `proxy/ssrf-vectors.json` like this repo's web proxy
(`electron/networkTrust.js` adds the DNS lookup, the grants file and the
dialog).

- Private, loopback, CGNAT and ULA addresses are refused until the user grants
  that one host, port and scheme, in a native dialog that only a button press
  can open. A background sync can never raise it.
- Redirect targets and link-local addresses can never be granted.
- In Cloud Sync, and in the dayGLANCE integration's WebDAV test, a connection
  test asks first (`sync/privateAddress.js`). A refused server says it needs
  permission and that it has not been contacted, with "Allow this address…"
  under it; once allowed, the test runs again. The allowed addresses are listed
  at the bottom of Cloud Sync, each with Remove.

A home Nextcloud on `192.168.x.x` and a vault on a Tailscale address are the
common cases this is for.

## Secure storage

`bridge.secureStore` uses Electron `safeStorage`, which is the macOS Keychain,
Windows DPAPI or the Linux secret service. Ciphertext is kept in
`userData/secure-store.json`. The app's existing shim
(`sync/secureConfigShim.js`) then keeps the sync credentials and keys there
instead of in web storage, as on the phones.

On Linux, `getSelectedStorageBackend()` can return `basic_text`, meaning there
is no keyring. The shell then reports `info.secureStorage` false and the app
keeps web storage, so the store never claims protection it does not give.

An unsigned or dev build on macOS may ask for the Keychain the first time.

## Direct Access

The desktop implements the **Android folder contract**: pick a folder, the
snapshot in it, and files by path below it (the roster and the intents event
set). The settings show "Choose folder", since they branch only on iOS.

The store (`directAccessStore.js`) is Electron-free and tested under vitest:

- paths are confined to the folder;
- writes replace crash-safely (temp file, fsync, rename);
- a zero-length file reads as `downloading`, never `absent`;
- a vanished folder reads as `error`.

Picking uses `dialog.showOpenDialog` with security-scoped bookmarks, which a
Mac App Store build would need; the folder is restored on launch. A debounced
`fs.watch` on the snapshot nudges a cycle, with its own writes suppressed,
through an `onChanged` event the phone bridges do not have. The 15 s poll stays
the source of truth.

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

**Tested.**

- `electron/icloud.test.js` runs the store over real files in a temp home.
- `src/sync/icloudDesktop.scenarios.test.js` runs the real transport, cycle and
  merge over that store, through the same adapter and bridge the app builds on
  a Mac: a Mac and an iPhone merging both ways, an edit written in place, and a
  Mac's first launch (an empty folder, the iPhone's file arriving later,
  nothing written by the Mac in between, then the question).
- On a real Mac, in the dev build (2026-11-15): it ran and synced.

**Still to see on a real Mac, with the signed build:** a read faulting in an
evicted file, and that macOS lets the signed build read `iCloud~com~lifeglance`
without a prompt. The log lines above say what each cycle did.

## Billing

The desktop app is free, like the web app and the sideload APK, in every build
but one: the **Mac App Store build** sells the app as the iOS app does. It
works the way dayGLANCE's and lastGLANCE's Mac App Store builds do, through the
same package.

**Universal Purchase.** The Mac app is the iOS app's App Store record with the
macOS platform added, under the iOS bundle id (`com.lifeglance`). So it sells
the iOS app's products (`lifeglance_pro_annual`, `lifeglance_pro_lifetime`),
and a purchase on an iPhone, an iPad or a Mac unlocks all three. RevenueCat
needs nothing new: its App Store app covers Mac receipts, and the Mac uses the
iOS public key. `electron/billingConfig.js` holds the three values, and
`billingConfig.test.js` holds them equal to `src/billing/billing.js` and the
Swift sources.

**Which builds are gated** (`src/billing/billingChannels.test.js` is the table):

| Build | Gated | Why |
|---|---|---|
| Mac App Store | yes | `info.isMAS`, which is `process.mas` |
| macOS Developer ID, Windows, Linux | no | no adapter is built; main registers no billing |
| web, PWA, sideload APK | no | unchanged |
| Play, iOS | yes | unchanged |

Two independent signals keep the direct builds free. The page builds an adapter
only when `info.isMAS` is true, and main registers billing only under
`process.mas`. Beyond both, `@glance-apps/billing/electron-main` answers
"entitled" to any build with no App Store receipt inside its bundle.

**How a purchase runs.**

- The page's adapter is `createElectronRendererAdapter({ api: bridge.billing })`.
  The entitlement engine, the paywall (`PaywallModal`), the reviewer code and
  its banner, and the Settings status are the ones the phones use, unchanged.
- Main calls `registerElectronBilling(() => live(mainWindow), MAS_BILLING)`
  once, after the first window. That is StoreKit through Electron's
  `inAppPurchase`, with the receipt validated by RevenueCat over REST from the
  main process. The package owns the trust rules (an unknown answer never
  locks, a lifetime purchase is latched in `userData/lifetime-purchased.json`
  and no later answer re-locks it); none of that is repeated here.
- **The window is a getter**, and has to be. Closing the window on macOS
  destroys it, and a click on the Dock icon creates another. Given a window,
  the package sent every result to that first one: a purchase made after
  reopening completed in StoreKit and left the paywall's spinner up until the
  next launch. This needs `@glance-apps/billing` 0.2.3 or later.
- Prices and the trial length come from StoreKit. Nothing is hardcoded.
- The paywall says "App Store", and "Manage subscription" opens Apple's
  subscription page in the browser, which hands over to the App Store.
- The gate has no close control, as on the phones.
- The paywall's list of what a purchase unlocks leaves out the home-screen
  widgets and the quick-add tile, which the Mac app does not have
  (`HAS_HOME_SCREEN_WIDGETS`). App Review reads that list against the app.

**The package's main half ships with the app**, the one exception to "no
`node_modules`" (see [Packaging](#packaging)). It registers its four
`subscription:*` handlers itself, so they carry no sender check of this app's;
they are reachable only through the preload, which only the main frame of the
main window has.

## Updates

There is no auto-update. Direct builds show a small notice when a newer release
can be downloaded (`useUpdateNotice.js`, `components/ui/UpdateNotice.jsx`): the
page asks 15 s after launch, every 6 hours and on return to the app; main reads
the repository's latest GitHub release (the page's CSP allows it no request)
and answers only for a published release that is newer and has a download for
this system, so a phone-only release is never announced on the desktop
(`electron/updateCheck.js`). Download opens the release page in the browser.
Dismissing hides that version for good.

## Packaging

**Identity.** `appId` is `com.lifeglance.app`, which matches Android.
`productName` is lifeGLANCE. The Mac App Store build is `com.lifeglance`, the
iOS bundle id, for Universal Purchase: `build:electron:mas` sets
`LIFEGLANCE_APP_ID`, and the config keys everything about that build on it,
since electron-builder has one `appId` for all targets.

**Targets.**

| System | Targets | Notes |
|---|---|---|
| macOS | `dmg` and `zip`, x64 and arm64 | Developer ID when `CSC_LINK` is set, ad-hoc otherwise |
| macOS, Mac App Store | `mas`, universal `.pkg` | sandboxed, built on a Mac by `build:electron:mas`, never in CI |
| Windows | `nsis` | unsigned, so SmartScreen warns on first run |
| Linux | `AppImage` and `deb`, x64 and arm64 | explicit arch list; arch in every AppImage name |

**Runtime dependencies.** The package ships no `node_modules`: the renderer is
one Vite bundle and main imports only Electron and Node. The one exception is
`@glance-apps/billing/electron-main` ([Billing](#billing)): its `package.json`
and its `dist/electron-main` folder ship, in every build, since main imports it
in every build. It imports only Electron and Node itself.
`electron/builderConfig.test.js` holds all of that.

**Signing.** `scripts/codesign-ad-hoc.cjs` (afterPack) and
`scripts/notarize.cjs` (afterSign), driven by `CSC_LINK`, `CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Hardened Runtime
is on for a Developer ID build. Both hooks skip a Mac App Store build, which
electron-builder signs with the distribution certificate from the keychain: the
sandbox takes Hardened Runtime's place there, and the App Store's review takes
notarization's.

**The Mac App Store build's entitlements** (`electron/entitlements.mas.plist`):
the App Sandbox, outbound network, a folder the user picks with its bookmark
(Direct Access), and the two iCloud containers the iOS app has. No inbound
network, since the app listens on nothing. StoreKit needs no entitlement.
`builderConfig.test.js` holds the list, and the containers equal to the iOS
app's.

**Versioning.** `package.json` is the single source, shared with the phones.

## Releasing

**Once, on this repository** (Settings, Secrets and variables, Actions): the
Developer ID secrets. They can be the same team's values dayGLANCE and
lastGLANCE use.

| Secret | What it is |
|---|---|
| `CSC_LINK` | the Developer ID Application certificate and key, exported as a `.p12` and base64-encoded |
| `CSC_KEY_PASSWORD` | the password chosen when exporting the `.p12` |
| `APPLE_ID` | the Apple ID email of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password, for the notary service |
| `APPLE_TEAM_ID` | the 10-character Team ID |

**Each release.**

1. To try the installers first, run **Desktop installers** from the Actions
   tab. A manual run builds all three systems and uploads the files to the
   run, without touching any release.
2. Tag the version (`v*`), as for the phones. `release-desktop.yml` builds the
   installers and adds them to that tag's GitHub release: uploaded to it if it
   exists, else a new draft. A published release stays published.
3. A tagged macOS build must be signed and notarized. Without the secrets the
   macOS job fails rather than publish a build Gatekeeper warns about; Windows
   and Linux are unaffected by that failure, but nothing is attached until all
   three have built.

`desktop.yml` runs on every change that can affect the desktop app: the shell's
tests, then the unpacked Linux app under xvfb with the smoke test.

### The Mac App Store build

Built on a Mac and uploaded by hand. CI does not build it: it signs from the
login keychain.

**Once.**

- **Apple Developer, App ID `com.lifeglance`:**
  - enable macOS for the App ID;
  - check that both iCloud containers, `iCloud.com.lifeglance` and
    `iCloud.com.dayglance`, are assigned to it (the iOS app already uses them);
  - create a **Mac App Store** provisioning profile for it, download it, and
    save it as `electron/lifeglance.mas.provisionprofile`. That path is
    git-ignored; `MAC_PROVISIONING_PROFILE` can point elsewhere.
- **Certificates in the Mac's login keychain:** "Apple Distribution" (or "3rd
  Party Mac Developer Application") to sign the app, and "Mac Installer
  Distribution" (or "3rd Party Mac Developer Installer") to sign the `.pkg`.
- **App Store Connect:** add the macOS platform to the existing lifeGLANCE app
  record. Universal Purchase then carries `lifeglance_pro_annual` and
  `lifeglance_pro_lifetime` to the Mac.
- **RevenueCat:** nothing. The iOS App Store app's configuration covers Mac
  receipts, as it does for dayGLANCE and lastGLANCE.

**Each release.**

```bash
npm ci
```

```bash
npm run build:electron:mas
```

This builds the universal `.pkg` in `dist-app/mas-universal/`, as
`com.lifeglance`, sandboxed. Its build number is `YYYYMMDD.HHMM`, so every
upload is higher than the last (`BUILD_NUMBER` overrides). The version is
`package.json`'s, as for the phones. Then:

1. Upload the `.pkg` with **Transporter**.
2. In App Store Connect, add the build to the macOS version and submit it for
   review. TestFlight for Mac works with the same build.
3. App Review needs a way past the paywall: the reviewer code, as for iOS
   (`npm run reviewer-code`).

**What to check on the build**, since none of it can run anywhere but a signed
build on a Mac:

- the paywall shows App Store prices and the trial length;
- a purchase unlocks, and so does one made after closing the window and
  reopening it from the Dock;
- Restore unlocks an Apple ID that already bought on an iPhone;
- the reviewer code unlocks, and its banner leads back to the paywall;
- "Manage subscription" in Settings opens Apple's page;
- iCloud reaches both containers ([iCloud Drive on macOS](#icloud-drive-on-macos));
- a Direct Access folder is still readable after a relaunch;
- no update notice appears.

## Tests

- **Unit tests**, beside each module in `electron/`, and for the page's side in
  `src/native/` and `src/sync/`, run with the rest of the suite (`npm test`).
- **The smoke test** (`e2e/electron-smoke.mjs`) launches the packaged app on a
  fresh profile and checks what no unit test can see. Besides the origin, the
  bridge, IndexedDB, the CSP and the window, it starts a local server and
  drives Cloud Sync against it: a WebDAV connection test is refused before the
  server is contacted, allowed through the dialog, then succeeds; the vault
  client verifies an account; bytes cross the bridge both ways; the vault's
  push arrives; the grant is revoked. It also picks a Direct Access folder,
  checks the bundled typeface, and switches the menu's language. And it checks
  that the build it launched, a direct one, is free: no paywall, and no billing
  registered in main.

## What is next

1. **A signed build on a real Mac**, for the two iCloud points above.
2. **The Mac App Store build's first run.** It is built and tested as far as a
   machine without a Mac, a certificate and a store can take it: the config,
   the entitlements, the bridge, the channels, and the paywall against a fake
   store. The list under [The Mac App Store build](#the-mac-app-store-build)
   is what a real one still has to show, and it needs the macOS platform added
   to the app's App Store Connect record first.
3. **Windows code signing**, to be rid of the SmartScreen warning. dayGLANCE
   and lastGLANCE ship unsigned too.
