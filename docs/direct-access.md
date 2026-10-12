# Direct Access sync

Sync through a folder a third-party tool already keeps in step across devices
(Nextcloud, Syncthing, FolderSync, Google Drive, Dropbox, OneDrive): lifeGLANCE
reads and writes one file there, and the tool moves it. The design is
dayGLANCE's `docs/direct-access-sync.md`; this tier is its Phase 7c, built
in the order that document gives, so the same folder carries all three apps:

1. **The folder bridge (this page).** `DirectAccessPlugin` on both shells,
   behind `src/native/directAccess.js`, which hands the transport the same
   bridge shape dayGLANCE's shells produce and lastGLANCE's
   `src/native/directAccess.ts` hands on. Android holds a folder (a SAF tree
   with a persistable grant, walked with DocumentFile; crash-safe writes
   through `SafeReplace`; paths confined by `DirectAccessPath`). iOS holds
   files, one security-scoped bookmark each for the snapshot
   (`lifeglance-sync.json`), the shared roster (`glance-users.json`) and the
   intents event set (`glance-events.json`), because the Files providers of
   the common cloud tools cannot hand an app a folder (Apple FB9703910). The
   read classification is the one every shell answers: `absent` only when the
   folder is there and the file is not; a zero-length file is `downloading`,
   never absent; a vanished folder or revoked grant is `error`. Web/PWA has no
   plugin and no tier.
2. **Snapshot sync through the folder (done).** `@glance-apps/sync`'s
   `runSnapshotFileCycle` (the cycle dayGLANCE's iCloud and Direct Access
   tiers and lastGLANCE's folder tier run: the seed guard, the content gate,
   the made-here-or-relayed rule with staggered relays, the envelope rules)
   over `src/sync/directAccess.js`, the transport. `src/sync/directAccessCycle.js`
   fills in what is this app's: the payload is the WebDAV engine's own
   (`buildEnginePayload` in `src/sync/engine.js`, read from IndexedDB before
   the cycle), the apply is the engine's `applyEnginePayload` and is awaited,
   milestones and chapters count as data, and the two device-local stamps are
   the WebDAV engine's local-modified key (so a change that arrived through
   the folder is pushed on by WebDAV) and `lifeglance-local-edit-at`, which
   `src/sync/dirty.js` sets on every local write before the GLANCEvault
   target check (`src/sync/localEditStamp.js`). The engine's apply runs under
   `withoutLocalEditStamp`, because it reaches `saveCategories` and that marks
   dirty: without the hold a change that arrived by WebDAV would look made
   here and be relayed at once. `src/hooks/useDirectAccessSync.js` owns the
   15 s poll, the foreground kick, the in-flight guard and the prompts; the
   section in the Cloud Sync dialog (`DirectAccessSection.jsx`) connects the
   folder (Android) or the file (iOS), with the per-device on/off and encrypt
   switches, "Sync now" and the last-synced stamp. Picking is the decision,
   so there is no first-run prompt; an encrypted file this device cannot
   read is never written over; a device without the key tries its cached key
   once, then raises the passphrase prompt the other tiers use, and
   unlocking kicks a cycle.
3. **The intents transport (after that).** dayGLANCE's single event-set file
   `GLANCE/events/glance-events.json`, as a third transport beside WebDAV and
   GLANCEvault in the dayGLANCE integration settings. lifeGLANCE has no
   household roster, so the roster slot stays unused here; the plugin keeps
   it so the three shells answer one contract.

## The plugin contract

Every method answers JSON shapes, promise-based (Capacitor):

| method | answer |
| --- | --- |
| `status()` (and on iOS `usersStatus()`, `eventsStatus()`) | `{ configured, name, path, reachable }` |
| `pickFolder()` (Android) | the status after the pick, or `{ cancelled: true }` |
| `pickFile({slot})`, `createFile({slot})` (iOS) | the status with `slot`, `{ cancelled: true }`, or a rejection naming why (a wrong file, a bookmark failure, with `data.path`) |
| `read()` (and `readUsers()`, `readEvents()`) | `{ kind: absent \| downloading \| error \| text, text?, error? }` |
| `write({text})` (and `writeUsers`, `writeEvents`) | `{ ok }` |
| `deleteFile()` | `{ ok }`; on iOS the bookmark is forgotten with the file |
| `disconnect()`, `forgetUsers()`, `forgetEvents()` | `{}` |
| `listFiles({rel})` (Android) | `{ names: [...] \| null }`; null when the path escapes the folder or the folder is unusable |
| `readFile({rel})`, `writeFile({rel,text})`, `deleteFileAt({rel})`, `makeDir({rel})` (Android) | as above, by path |

The JVM tests pin the confinement rule (`DirectAccessPathTest`), every branch
of the read classification (`DirectAccessReadTest`) and every crash window of
the write (`SafeReplaceTest`); `src/native/directAccess.test.js` pins the
bridge shape on both platforms; `src/sync/directAccess.test.js` the
transport's state machine over a fake bridge; `src/sync/directAccessCycle.test.js`
two devices over one folder through the real package cycle and the real
merge (seed, apply, an edit made here written at once, a relayed change
deferred and staggered, the envelope rules, a deletion's tombstone, a device
without the key held); `src/sync/localEditStamp.test.js` the stamp and the
hold around an apply.

## Storage

| key | holds |
| --- | --- |
| `lifeglance-direct-access-enabled` | `'true'` / `'false'` / absent (absent is on once connected) |
| `lifeglance-direct-access-encrypt` | `'true'` when this device seeds or upgrades the file as an envelope |
| `lifeglance-direct-access-last-synced` | stamped on every read of a real snapshot; the seed guard's "has synced before" |
| `lifeglance-direct-access-last-synced:writers` | the `writtenBy` ids seen in the file header; ranks this device's relay wait |
| `lifeglance-cloud-sync-local-modified` | shared with the WebDAV engine: when this device last changed synced data |
| `lifeglance-local-edit-at` | when this device itself last changed its data |
| `lifeglance_direct_access` (shell preferences) | the Android tree URI / the iOS bookmarks (`lifeglance.directAccess.{file,users,events}Bookmark`) |

## Where the code lives

- Android: `android/app/src/main/java/com/lifeglance/app/directaccess/`
  (`DirectAccessPlugin`, `DirectAccessRepository`, `DirectAccessRead`,
  `DirectAccessPath`, `SafeReplace`), registered in `MainActivity`.
- iOS: `ios/App/App/DirectAccessPlugin.swift`, registered in
  `MainViewController.capacitorDidLoad()` and listed in the Xcode project
  (a plugin file the project does not list never reaches the target, and the
  JS probe then answers false on a shell that looks complete).
- Web: `src/native/directAccess.js` (the bridge), `src/sync/directAccess.js`
  (the transport), `src/sync/directAccessCycle.js`, `src/sync/localEditStamp.js`,
  `src/hooks/useDirectAccessSync.js`, `src/components/sync/DirectAccessSection.jsx`.

Ported from lastGLANCE (its `docs/direct-access.md`); keep the shells in sync
when fixing bugs in either.
