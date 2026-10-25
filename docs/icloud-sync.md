# iCloud sync

Zero-config sync for the iOS app: every iPhone and iPad signed in to the same
Apple ID keeps the timeline in step through iCloud, with nothing to set up. It
is dayGLANCE's iCloud tier (`src/sync/icloudSnapshotTransport.js`,
`src/utils/icloudSyncPref.js`, `dayglance-ios/.../ICloudBridge.swift`) and
lastGLANCE's (`src/sync/icloud.ts`), built on this app's file-tier machinery:
the same cycle Direct Access runs (`docs/direct-access.md`).

## Pieces

- **The plugin**, `ios/App/App/ICloudPlugin.swift`, registered in
  `MainViewController`. Files by path under a container's `Documents/`, in
  one of two containers:
  - `own`, `iCloud.com.lifeglance`: `lifeglance-sync.json`, the timeline;
  - `dayglance`, `iCloud.com.dayglance`: dayGLANCE's `GLANCE/events/`, for
    intents.

  Reads answer the classification every file shell answers (absent,
  downloading, error, text), with dayGLANCE's two iCloud rules: a local copy
  is served only once it is `.current` (every read asks the daemon to
  download), and `allowStale` reads the last downloaded copy. An
  NSMetadataQuery on the sync file posts `changed`, which runs a cycle at
  once. The snapshot is written atomically; event files in place, keeping the
  xattrs that queue the upload.
- **The bridge**, `src/native/icloud.js`: the plugin's calls, every failure
  answered rather than thrown. iOS only; elsewhere `icloudBridge()` is null
  and nothing below runs.
- **The transport**, `src/sync/icloud.js`, with its own seed-guard stamp
  (`lifeglance-icloud-last-synced`). Plaintext (iCloud Drive is encrypted by
  Apple), so `encryptsWrites` is false and an envelope is rewritten plain
  (`allowsPlaintextReseed`). 15 s poll, 5 s write throttle, and a download
  stalled past `ICLOUD_DOWNLOAD_GRACE_MS` (2 min) is read from the last
  downloaded copy. Availability is re-probed every cycle, so iCloud switched
  off mid-session goes quiet and comes back by itself.
- **The hook**, `src/hooks/useSnapshotFileSync.js`, shared with Direct Access
  (`useDirectAccessSync` is a thin wrapper): the poll, foreground and change
  kicks, the key prompts, and the first-run question. One in-flight guard
  spans every instance, so iCloud and Direct Access never merge into the
  store at once.

## The rules

- **On by default, and a per-device switch.** The preference
  (`lifeglance-icloud-sync-enabled`) is tri-state: absent means on and
  undecided, `'true'`, `'false'`. Off is inert: nothing is read or written,
  and the iCloud copy and other devices are untouched. The switch is in Cloud
  Sync (`ICloudSection.jsx`).
- **A fresh install is asked before anything is restored.** Deleting the app
  leaves the file in the container, and reinstalling turns iOS's per-app
  iCloud switch back on, so without the question the app would restore
  silently. The cycle asks (`prompted`) when the decision is open, iCloud
  holds data and this device holds none (`ICloudFirstRunModal.jsx`); either
  answer is recorded, and "start fresh" turns the switch off. A device with
  data of its own merges without asking, which is what keeps it zero-config.
- **Data is milestones and chapters** (`payloadHasData`), as for the folder.
  A native install starts empty (the demo timeline is the hosted build's
  only), so nothing else is needed for the question to come.
- **The stamps are the folder tier's.** The apply stamps the WebDAV engine's
  local-modified key, so a change that arrived through iCloud is pushed on by
  WebDAV or GLANCEvault too, and `lifeglance-local-edit-at` decides "made
  here".

`src/sync/icloudSync.scenarios.test.js` walks two devices over one container
with the real transport, cycle and merge.

## Intents

`src/lib/intentsICloudTransport.js`, after dayGLANCE's iCloud intents: one
file per event (the package's `filenameFor`) in `GLANCE/events/` of
dayGLANCE's container, so lifeGLANCE, dayGLANCE and lastGLANCE exchange
intents with nothing but iCloud. A fourth choice of the one intents transport
(`transport: 'icloud'`, offered on iOS only in the dayGLANCE integration
settings), so it is opt-in and off by default like the others. Always
plaintext: dayGLANCE's iCloud poll refuses an encrypted envelope as a
misconfigured sender, and this poll does the same. The deliverer holds while
the integration is off or iCloud is away; the poll runs on the integration's
cadence in `useIntentPoller`, keeps its own strict filename cursor
(`lifeglance-icloud-intents-cursor`, as the WebDAV poll does, so an event is
handed over once), and stops at a file still downloading so it is read on a
later poll. dayGLANCE prunes old event files from the folder.

## Setting it up (once, in the Apple Developer portal)

1. Create the iCloud container `iCloud.com.lifeglance`.
2. On the `com.lifeglance` App ID, enable iCloud (CloudKit/Documents) and
   assign both `iCloud.com.lifeglance` and `iCloud.com.dayglance`.
3. Regenerate the provisioning profiles (Xcode's automatic signing does this
   on the next build).
