# SecureStore device verification

Manual pass for the secure credential storage work (Keystore-backed on
Android, Keychain-backed on iOS). Run it on real hardware before the
TestFlight submission — none of this is CI-checkable, because the crypto under
test lives in the OS. The unit suite already covers the migration *logic*
(`src/sync/secureConfigShim.test.js`, `src/sync/nativeKeyHooks.test.js`) and
the web/PWA no-op path; this script covers everything else.

## Background needed to follow this script

Three secrets are in scope, and where they live after this change:

| Secret | Before | After (native shells) |
|---|---|---|
| WebDAV app password | `localStorage` `lifeglance-cloud-sync-config` (+ a copy in `lifeglance-intents-config`) | SecureStore, same key names |
| GLANCEvault device token | `localStorage` `lifeglance-cloud-sync-config` (`vaultToken` field) | SecureStore, same key name |
| Sync encryption keys (file-tier sync key + DB root key) | IndexedDB `lifeglance-crypto` / `lifeglance-crypto-db` | SecureStore, entries `crypto.sync-key` / `crypto.db-root-key` |

"SecureStore" is the app-local plugin: on Android, AES-GCM ciphertext in the
private prefs file `lifeglance_secure_store` with the key in the Android
Keystore; on iOS, Keychain items under service `lifeglance_secure_store` with
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.

Deliberately NOT migrated (known residual): the intents/blob root keys in
IndexedDB `lifeglance-intents-crypto`. They are non-extractable `CryptoKey`s
that JS cannot export; do not report their presence in IndexedDB as a failure.

**Inspecting WebView storage.** With the device connected and the app
debuggable, open `chrome://inspect` (Android WebView) or Safari →
Develop → <device> (iOS WKWebView), attach to the app, and in the console run:

```js
localStorage.getItem('lifeglance-cloud-sync-config')
localStorage.getItem('lifeglance-intents-config')
localStorage.getItem('lifeglance-db-sync-config')
indexedDB.databases().then(dbs => console.log(dbs.map(d => d.name)))
```

For the IndexedDB checks, `lifeglance-crypto` / `lifeglance-crypto-db` may
still *exist* as empty databases; what must be absent is the key records —
verify via the Application/Storage tab of the inspector, stores `keys`
(record `sync-key`) and `db-root-keys` (record `db-root-key`).

> Release builds may not be inspectable. Run storage checks on a debug build
> of the same commit; run the reboot/backup scenarios on whichever build you
> intend to ship.

## 1. Fresh install — both platforms

Do once on Android, once on iOS.

1. Uninstall any existing build (Android: also verify no restored prefs —
   uninstall, reboot, reinstall).
2. Install this build, complete onboarding.
3. Configure WebDAV sync with a real server + app password, enable encryption
   with a passphrase. Configure GLANCEvault with URL, device token, account
   id, passphrase. Let a sync complete.
4. Inspect WebView storage (console commands above). **Pass:** all three
   `localStorage` reads through the *inspector on the running app* return the
   config JSON (they're served from the shim's cache), BUT after force-killing
   the app and re-inspecting before it repopulates — or more simply, on
   Android, pulling the app's data dir (`run-as com.lifeglance.app` on a
   debug build) — the real `localStorage` backing store contains none of the
   three keys, and the `sync-key` / `db-root-key` IndexedDB records are
   absent.
5. Android only: confirm `shared_prefs/lifeglance_secure_store.xml` exists
   and every value starts with `v1:` (ciphertext, not plaintext).
6. Kill and relaunch the app. **Pass:** sync still works, no passphrase
   re-prompt, no re-entry of credentials.

## 2. Upgrade migration — Android only (real user base)

1. Install the **previous release** (v3.2.0 / current Play build). Configure
   WebDAV + vault + passphrase as above; let a sync complete. Verify via
   inspector that credentials are in plaintext `localStorage` (pre-change
   state).
2. Install this build **over it** (`adb install -r`, or Play internal track
   update).
3. Launch once, let it settle, then inspect. **Pass:**
   - the three `localStorage` keys are gone from the real backing store;
   - `lifeglance_secure_store.xml` holds `v1:` ciphertext entries for them;
   - the `sync-key` and `db-root-key` IndexedDB records are gone (note: the
     IndexedDB half migrates lazily on first key *use* — trigger a sync and,
     if encryption was configured, an encrypted upload before checking);
   - **the user was never prompted** to re-enter the password, token, or
     passphrase, and sync completes normally.
4. Kill/relaunch again. **Pass:** still no prompts.

## 3. Failed migration leaves originals intact — Android

Simulating a Keystore failure on stock hardware is impractical; this scenario
is covered by unit tests with a rejecting/lying fake plugin
(`secureConfigShim.test.js`: "failing native layer" and "read-back verify"
cases). On device, do the cheap proxy check instead:

1. On the upgraded install from §2, airplane-mode the device, force-kill and
   relaunch several times in a row. **Pass:** credentials survive every
   relaunch (the migration is idempotent and never in a state where both
   copies are gone).

## 4. Web / PWA unchanged

Covered in CI: the full suite passes unmodified, and the shim/hooks are
no-ops where the plugin is absent. On a browser, sanity-check that sync still
configures and syncs; credentials remain in `localStorage` there by design.

## 5. Backup-restore to different hardware — iOS, two devices

Intended consequence of `ThisDeviceOnly`: credentials must NOT travel.

1. On iPhone A (configured as in §1), take an iCloud or encrypted local
   backup.
2. Restore that backup onto iPhone B. Launch lifeGLANCE.
3. **Pass:** the app treats sync as not configured (Keychain items were not
   restored; the shim reads absent). The user is asked to set up credentials
   afresh — re-entering server, password/token, and passphrase. No crash, no
   cryptic sync error loop.
4. Note for support scripts: because both tiers share one config object, the
   *whole* sync setup (server URL, folder, account id) is re-entered on the
   new device, not just the secrets. This is expected.

## 6. Reboot, then background sync before first unlock — iOS

Validates AfterFirstUnlock over WhenUnlocked: sync and the vault SSE reader
may run while the device is locked-but-booted.

1. On a configured iPhone, enable vault sync with SSE working (make a change
   from another device and see it arrive).
2. Reboot the iPhone. **Unlock it once** (AfterFirstUnlock requires one
   unlock per boot), then lock it and leave it locked.
3. From another device, make a synced change; if background refresh is
   granted, wait for a background wake (or trigger one via Xcode's simulate
   background fetch on a dev build).
4. **Pass:** the locked-but-unlocked-once device processes the change (visible
   immediately on next foreground, with no passphrase/credential prompt and
   no Keychain `errSecInteractionNotAllowed` in the console logs).

## Recording results

For each section note device model, OS version, app build number, and
pass/fail. Any failure in §2 is a release blocker: it means an existing
Android user would lose working credentials on upgrade.
