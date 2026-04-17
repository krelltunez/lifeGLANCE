# Post-v1.0 Plans: Tests and Photo Storage Migration

## #5 — Test coverage

### Goal
Protect the core data logic from regressions without slowing down UI iteration.
Scope deliberately to pure utility functions and the DB layer — no React component tests for now.

### Setup
Add [Vitest](https://vitest.dev/) (already aligned with Vite's config, zero extra config needed):

```
npm install -D vitest
```

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

### What to test

| Module | Tests |
|--------|-------|
| `src/utils/icsParser.js` | All-day event parsing, timed event skipping, empty/malformed input, multi-event files |
| `src/utils/dates.js` (`buildDateFromParts`) | All three precision modes (day/month/year), edge cases (Feb 29, Dec 31) |
| `src/utils/timeline.js` | `applyRecurFilter` — `all`, `past`, `future`, `next` modes against a known set of fixtures |
| Recurrence generation | Extract the year-expansion loop from `handleSave` into `src/utils/recurrence.js`, then test base year, end year clamping (+99), and instance count |
| `src/data/milestones.js` | `addMilestone`, `updateMilestone`, `deleteMilestone` against a real in-memory IndexedDB via [`fake-indexeddb`](https://github.com/dumbmatter/fakeIndexedDB) |

### Recommended order
1. `icsParser` — pure function, highest return on investment
2. `dates` — small, critical, easy to break
3. Recurrence — requires extracting the loop from `TimelineView.jsx` first (good cleanup anyway)
4. `milestones` DB layer — needs `fake-indexeddb`, more setup but covers the riskiest path

### Out of scope for now
React component tests (too brittle for the current pace of UI changes).
E2E / Playwright (useful later, not blocking).

---

## #6 — Photo storage: data-URI → IndexedDB blob

### Problem
Photos attached to milestones are stored as base64 data-URI strings directly in the
`milestones` IndexedDB object store. This means every call to `dbGetAll()` deserializes
the full image payload for every milestone that has a photo. Audio/video already live in
the dedicated `media` blob store, which streams lazily — photos should do the same.

### Plan

#### 1. Extend the media store key convention
Reuse the existing `media` store. Audio/video keys are the milestone `id`. Photos get
the key `${id}-photo`. This avoids a new object store and keeps the blob API uniform.

New helpers to add to `src/data/db.js`:
```js
export function dbPutPhoto(id, blob, mimeType) { /* put { id: `${id}-photo`, blob, mimeType } */ }
export function dbGetPhoto(id)                  { /* get `${id}-photo` */ }
export function dbDeletePhoto(id)               { /* delete `${id}-photo` */ }
```

#### 2. DB version bump to 3
In `onupgradeneeded` for `oldVersion < 3`:
- Open a cursor on the `milestones` store
- For each record with a non-empty `photo_uri`:
  - Convert the data-URI to a `Blob` (atob → Uint8Array)
  - Put the blob into the `media` store with key `${id}-photo`
  - Delete `photo_uri` from the milestone record
  - Set `has_photo: true` on the milestone (so the app knows to look up the blob)
- Transactions in `onupgradeneeded` are synchronous-cursor based — this is how the v1→v2
  audio migration already works (see `db.js` lines 27–37).

#### 3. Write path — `AddMilestoneSheet`
Replace the `FileReader` / `readAsDataURL` flow with a `File` object passed through
(same pattern as audio/video `mediaFile`). Add a `photoFile` state alongside `mediaFile`.
In `handleSave` (TimelineView), call `dbPutPhoto` after the milestone is written.

#### 4. Read path — `MilestoneDetail`
On mount, call `dbGetPhoto(milestone.id)` → `URL.createObjectURL(blob)` and store in
local state. Revoke the object URL on unmount (`URL.revokeObjectURL`). This is identical
to how `MilestoneDetail` already handles audio playback.

#### 5. Backup/restore
`handleSaveBackup` exports milestones JSON — photos are currently embedded as data-URIs,
so backup files are self-contained. After migration, backup would no longer include photo
data unless we explicitly serialize blobs. Options:
- **Simple:** exclude photos from backup (document the limitation). Restore still works;
  photos are lost on a fresh restore.
- **Better:** add a separate `photos` key to the backup JSON containing
  `{ [id]: dataUri }`, round-tripping blobs through base64 only at export/import time.

Recommend the "better" option — implement alongside the main migration.

### Risks
- Data migration runs once on first open after the update; if interrupted (tab closed
  mid-migration), the DB upgrade transaction rolls back cleanly — no partial state.
- `URL.createObjectURL` object URLs must be revoked on unmount to prevent memory leaks;
  easy to miss in components that remount frequently.
- Backup format change is a breaking change for anyone who manually parses backup JSON.

### Effort estimate
~4–6 hours including testing and a careful review of the migration cursor logic.
Do **not** rush this before a release — it touches existing user data.
