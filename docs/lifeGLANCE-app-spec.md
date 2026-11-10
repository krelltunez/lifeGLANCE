*Working document. Captures sequencing, architectural decisions, and open questions.*

Status checked against the tree on **9 November 2026** (lifeGLANCE 4.0.1).

---
## Sequencing

- **v3.5: iOS app** — *shipped*
  - Native iOS app: widgets (Home and Lock Screen), share extension, Siri and
    Shortcuts, Core Spotlight, zero-config iCloud sync, Direct Access, App Store
    billing. See `docs/lifeglance-native-roadmap.md` for the full surface.
  - Shipped alongside the existing web, Docker and Android builds.

- **Next 4.x release** — prerequisites for Lives
  - **Undo/redo fix** (krelltunez/lifeGLANCE#370). Undo replayed a whole-timeline
    snapshot through the backup-restore path, which wiped every photo and audio
    clip on the device. With several Lives it would also have deleted every
    other Life's milestones. It is now delta-based (`src/data/undoHistory.js`).
  - **Forward-compatibility release** (Phase 1 below). Every write says which
    build made it, and newer data passes through intact, so v5.0 can tell when
    it is safe to turn Lives on.

- **v5.0.0: Lives** — *designed, not built*
  - "Lives" is a new top-level entity; existing data migrates to the "Me" Life
  - One milestone can belong to several Lives (a wedding is on both spouses' timelines)
  - Compare/overlay view (date-aligned, read-only)
  - Export/import with merge as the v1 contribution path
  - Relationships stored as directed edges, exposed only as a "relationship to Me" picker
  - Repositions product from self-tracking to biographical record-keeping

- **v5.1** — age-aligned compare view (render change on the v5.0 axis abstraction)

### What exists of Lives today

Only a slot in the sync wire format, and it is less ready than earlier drafts
of this document claimed ("expands with no architectural change"):

- `src/sync/entityIds.js` hardcodes `LIFE_ID = 'default'`. Bundle row ids are
  `life:default:<kind>` (categories, birthday, both tombstone maps).
- **GLANCEvault:** `src/sync/dbAdapter.js` strips `life_id` on apply, so no
  stored record carries a Life. Up to 4.0.x it pushed `life_id: 'default'`; from
  Phase 1 it pushes the writer stamp there instead.
- **File tier** (WebDAV, iCloud, Direct Access, auto-backup): `src/sync/adapter.js`
  reads and writes only `lives.default`. Up to 4.0.x, `mergePayloads` returned
  `{ lives: { default } }` with only the keys it knew, so anything else was
  **dropped** from the shared file on the next write. From Phase 1 it passes
  unknown keys through and adds the `writers` map.
- **Manual JSON export** (`TimelineView.jsx`) is a separate flat format with no
  `lives` key, and restore **replaces** everything. There is no merge-import.
- Birthday is one global localStorage key read in ~15 places. Categories are
  global in localStorage but sit inside the per-Life envelope on the wire.
- There is no Life entity, no Life switcher, no compare view, no migration.

### What a 4.0.x client would do with Lives data

Traced through `dbAdapter.js` and `adapter.js` as of 4.0.1. The left column is
the original per-Life-slot design (`lives.<lifeId>`, `life:<lifeId>:<kind>`,
envelope `life_id`); the right column is the in-record design v5.0 uses instead
(see "Where ownership lives on the wire").

| Hazard with a 4.0.x client | Per-Life slots | In-record (chosen) |
|---|---|---|
| Other Lives' milestones reassigned to Me (strips `life_id`, re-pushes `'default'`) | yes | **no**: extra record fields survive the merge and re-push |
| Chapter re-push loop (equality check compares `life_id` with `'default'`) | yes, every cycle | **no** (one harmless echo per chapter, see Phase 1) |
| Another Life's birthday / categories merged into Me's (bundles routed by `_kind`) | yes | **no**: there are no per-Life bundles |
| New collections dropped from the shared file | yes | yes, but self-healing: a drop is not a deletion, so the next v5.0 write restores them |
| New vault row kinds reported as "skipped rows" every cycle | yes | yes, noise only |
| Other Lives' milestones *shown* on the old client's timeline, and editable there | yes | yes: the one real remaining risk, handled by the v5.0 gate |

---

## Lives (v5.0.0)

Multiple complete timelines, each representing a different person (or pet, or
other living or non-living subject). Examples: "Me", "Mom", "Dad". Switchable
from a dropdown. Each Life has its own Chapters and its own milestones, and a
milestone may be shared between Lives.

### Naming: Lives, not Subjects

The term is **Life** (singular) / **Lives** (plural). Lives is warmer than
Subjects, matches lifeGLANCE's existing language, and does emotional work. A
memorial preserves a life, a resume shows the shape of a life so far, family
history captures lives.

### Decisions locked in

**Data model**

- Life is a new top-level entity, synced as its own row kind.
- **Life fields:** `id`, `name`, `birthDate`, `deathDate?`, `photo?`, `color?`,
  `notes?`, plus the Me marker and `nickname?` / `about?` (see "The Me Life").
  `relationshipToUser` is **not** a field; relationships are edges (see below).
  `birthDate` replaces the global birthday key.
- **Milestones can belong to several Lives.** This is a key feature (a wedding,
  a move, a birth). A milestone therefore carries a *set* of Lives, not a single
  `life_id`. Two devices can each add or remove a Life from the same milestone,
  so the set must merge without one side overwriting the other: model it like
  Chapter membership (`milestoneIds` with `memberOps`, an LWW element set).
- **Chapters belong to one Life** (proposed, see open question 6).
- **Categories are global**, shared by every Life. They stay where they are on
  the wire (`lives.default.categories`, `life:default:categories`).
- **Where ownership lives on the wire: inside the records** (decided in Phase 1).
  - A milestone's Life set is a field of the milestone record (an LWW element
    set, like Chapter `memberOps`). No field means Me.
  - A Chapter's Life is a `lifeId` field of the chapter record. No field means Me.
  - Life records and relationship edges are new vault row kinds, and new arrays
    (with their own tombstone maps) under `lives.default` in the file.
  - All file data stays under `lives.default`; there are no `lives.<lifeId>`
    slots and no `life:<lifeId>:<kind>` bundles. The envelope `life_id` does not
    name a Life; it carries the writer stamp (see "Sync and version skew").
  - Why: shared milestones cannot live under per-Life slots (a wedding cannot sit
    under two keys), and keeping ownership in the record removes most of the
    damage a 4.0.x client would do (table above).
  - Field names are settled in Phase 2.
- **Migration:** all existing milestones, chapters and the birthday attach to
  the Me Life. IndexedDB v7; idempotent; safe to re-run after an interrupted
  upgrade.

**The Me Life**

- Exactly one Life is Me. The marker is fixed: Me cannot be deleted, cannot stop
  being Me, and its official label is always "Me".
- Optional `nickname` / `about` fields let the user personalise how Me is shown
  without changing the marker.
- The marker is a field on the Life record, not a name match, so renaming or
  translating "Me" can never lose it. *(Field name to settle in Phase 2.)*
- Because Me is fixed, "self" is **not** an option in the relationship picker.

**Compare / overlay view**

- Multi-select Lives to display simultaneously.
- Date-aligned (absolute dates, e.g. "I was 7 when Mom started her PhD").
- Stacked rows, one per Life, sharing the time axis; each Life's milestones and
  Chapters render in its colour.
- A shared milestone appears on every selected Life's row it belongs to.
- Drilling into a Life's Chapter from compare view collapses to single-Life
  mode for that Chapter; the breadcrumb returns to compare.
- **Compare view is read-only in v5.0.** This removes the wrong-Life-edit bug
  class before it exists.
- **The axis is a function of the Life, not hardcoded absolute dates.** Ship
  date-aligned only in v5.0, but keep the x-axis transform parameterized so
  age-alignment in v5.1 is a render change, not a rewrite. In code today,
  `dateToX` (`src/utils/timeline.js`) is already pure; the anchor on "today" lives
  in `Timeline.jsx`, and ticks (`getTickMarks`) are calendar years, so
  age-alignment will need an age-tick generator.
- **`deathDate` ends a Life's row** rather than extending it to today. Ongoing
  Chapters on that Life end at `deathDate`. The "today" marker and calendar
  gridlines span the shared axis; rows that end earlier simply stop.

**Current Life UX**

- Persistent, prominent, visually distinctive indicator: accent colour tints
  chrome, name in header, photo. The existing `--drill-color` CSS variable is the
  tinting mechanism to reuse.
- Transient visual cue when switching ("Now viewing: Mom").
- Breadcrumb becomes Life-explicit: **"Mom › University"**. (Today the first crumb
  is the lifeGLANCE logo markup, not a translated "Life" string, so this adds a
  new string in every locale.)

**OS surfaces are Me-only in v5.0**

Widgets, Spotlight, Siri / App Intents (AddMilestone), the share extension,
deep links, and dayGLANCE / lastGLANCE inbound intents all read or write the Me
Life only. Their native readers (`WidgetModel.swift`, `WidgetData.kt`,
`SpotlightPlugin.swift`) are untouched in v5.0. Per-Life OS surfaces are out of
scope.

**Contribution / collaboration**

- Export/import is the v1 mechanism: one person exports Lives, a family member
  imports and **merges** them into theirs.
- **Matching Lives on import:**
  1. Same Life `id` (the export descends from the same data): match automatically.
  2. Otherwise show a preview that *suggests* matches by name and birth date;
     the user confirms or rejects each. **Never merge on name alone.**
  3. Unmatched Lives import as new Lives.
- After matching, Lives are deduplicated and the relationship edge sets are
  unioned (edges need no re-anchoring; see below).
- Real-time collaboration is deferred.

### Relationships: stored as edges

**Decision: relationships are stored as directed edges between Lives, and
exposed in v5.0 only as a simple picker.**

A separate relationships record holds `fromLifeId`, `toLifeId`, `type`, plus an
optional freeform `relationshipNote`.

**What ships in v5.0:** a "relationship to Me" dropdown on the Life editor
(parent / child / spouse / sibling / other). Selecting one writes a single edge
from the Me Life. No relationship editor screen, no tree view, no genealogy
features, no additional user-facing surface of any kind.

**What this buys later:** the general relationship editor and any family-tree
rendering can be added without a data migration and without asking existing
users to re-enter their family.

**Relationship to lifeGLANCE Studio.** Genealogy and family-tree rendering may
end up existing only in Studio (the commercial export-as-artifact product)
rather than in lifeGLANCE itself. This strengthens the decision: Studio has no
data of its own and reads what lifeGLANCE captured, so the free app's data shape
is the input to the paid product. Attribute-style labels would leave Studio
unable to render a tree without making users re-enter their entire family.

**Boundary: capture is free, rendering is paid.** Relationship data is captured,
stored, and exported by lifeGLANCE and must not be gated behind Studio. Studio's
value is the artifact it produces, not custody of the underlying data. This
follows the existing FOSS-first model and satisfies the legacy-planning use case,
which requires a full data export in a format that survives the product.

**Supporting rationale:**

- **Import/merge correctness.** A sibling's export carries relationship values
  anchored to *them*. On merge those values are wrong from the receiving user's
  vantage point, and there is no mechanical rewrite rule. Edges need no
  re-anchoring: dedupe Life nodes, union the edge set.
- **Non-self relationships are unrepresentable as an attribute.** "Mom and Dad
  are both parents of me" cannot express that Mom and Dad are married.
  "Grandma is a grandparent" loses which side of the family.
- **Direction is explicit.** An attribute value of "parent" is ambiguous about
  who is whose.
- **Cardinality.** Step-relations, half-siblings, adoption, and remarriage
  produce several simultaneous relationships between the same pair.
- **Consistency with the repositioning.** v5.0 makes Lives peers. A field named
  `relationshipToUser` keeps the self-tracking assumption structurally embedded.
- **Irreversibility.** This is one of the few v5.0 schema choices that is
  expensive to change once users have data. Edges cannot be derived from
  self-anchored labels without guessing.

**Accepted costs:** slightly more storage work than a single field, and a
standing scope-creep risk. Mitigation: edges are stored, but only the
single-dropdown surface ships. Any relationship UI beyond that dropdown is out
of scope for v5.0 and is named as such in the phase prompt.

### Sync and version skew

**The gate (decided in Phase 1).** v5.0 turns on multi-Life data (any Life
besides Me, any shared milestone) only when every device that has synced in the
last **60 days** runs v5.0. Until then it works as single-Life and shows which
devices still need updating. A device not seen for 60 days stops counting, so an
abandoned device cannot block Lives forever. The window is
`WRITER_WINDOW_DAYS` in `src/sync/writerStamp.js`.

**Writer stamps (shipped in Phase 1, sync schema 1; v5.0 writes schema 2).**

- **GLANCEvault rows:** the envelope's `life_id` carries
  `{ set: 'default', schema, device, app, platform }`. It has to be that field:
  a 4.0.x client keeps every other envelope key in its store and re-pushes it on
  its next edit, so a stamp anywhere else would make an old device's writes look
  like a newer device's. `life_id` is the one field 4.0.x strips on apply and
  overwrites with the plain string `'default'` on push.
- **File tier:** a top-level `writers` map, device id → `{ schema, app,
  platform, day }`, merged per device by latest UTC day and pruned at 60 days.
  `day` changes at most once a day, so an idle device does not rewrite the file.

**How v5.0 detects a device older than Phase 1.**

- **Vault:** a row pulled after this device's first full sync (cursor above 0)
  whose `life_id` is the plain string `'default'` was written by a pre-Phase-1
  client.
- **File tier:** a 4.0.x write drops every top-level key it does not know, so a
  file whose `writers` map no longer holds this device's own entry (which it
  wrote last time) was rewritten by a pre-Phase-1 client.

**What Phase 1 clients do with v5.0 data.** They keep it intact and say so:

- File tier: keys they do not know, at every level (top level, `lives.*`,
  `lives.default.*`), pass through the merge from the file untouched. They are
  never stored locally, and never count as a change to apply or write.
- Vault: row kinds they do not know are left on the server, not stored, not
  pushed, not reported as skipped. Unknown fields inside milestone and chapter
  records were already kept and re-pushed.
- Either tier: a stamp with a schema above their own shows a once-per-session
  notice asking the user to update that device.
- They still *show* other Lives' milestones as their own, because they do not
  know the v5.0 fields. The gate is what keeps v5.0 from writing those while a
  Phase 1 device is active.

**Known cost.** The first time a 4.0.x client pulls a stamped chapter row, its
equality check (which compares `life_id` with `'default'`) fails and it re-pushes
the chapter once, unstamped. Phase 1 compares chapters without the envelope, so
that echo converges on the next pull instead of looping.

**Me's birthday:** v5.0 keeps writing Me's `birthDate` to the legacy birthday
key and bundle while any older client is active, so their age labels stay right.

### Open questions

1. ~~Age-aligned compare view in v1?~~ **Resolved:** v5.1; axis transform stays parameterized.
2. ~~Editing in compare view?~~ **Resolved:** read-only in v5.0.
3. ~~Relationship field shape?~~ **Resolved:** edges, single picker in v5.0.
4. ~~Breadcrumb phrasing?~~ **Resolved:** "Mom › University".
5. ~~Categories global or per-Life?~~ **Resolved:** global.
6. **Chapters across Lives.** Proposed: a Chapter belongs to exactly one Life,
   and may contain any milestone that belongs to that Life (including a shared
   one). Confirm before Phase 2.
7. **Undo with Lives.** The new undo history records milestone deltas; with
   shared milestones, a delta can touch Life membership. Phase 2 must decide
   whether membership changes are undoable (proposed: yes, through the same
   LWW set, never by rewriting the whole set).
8. **Deleting a Life.** Proposed: a Life other than Me can be deleted; its
   unshared milestones and its Chapters go with it (tombstoned); shared
   milestones just lose that Life from their set. Needs a confirm step.
9. **Life photo storage.** Proposed: the GLANCEvault blob path already used for
   milestone media (`src/blobs/`), with a local copy like milestone photos.

## Decisions to be made (keeping in mind future export-as-artifact functionality)

**Life metadata richness.** The Life schema above is adequate for timelines but
thin for biographical artifacts. Memorial exports want birthplace and places
lived; resume exports want a professional summary and current location. Lean
toward first-class optional fields for anything an export template would query,
added when a template needs it. Alternatively, these can be part of the artifact
creation process.

**Sync envelope and artifact-relevant data.** Artifact-relevant metadata
(photos, attachments, rich-text descriptions, external links) must sync as well
as the structured data does. If the export experience depends on a photo that
didn't make it to the device generating the artifact, the experience fails.

**Resolved by GLANCEvault, and built.** lifeGLANCE carries media through
GLANCEvault blobs (`src/blobs/`: encrypted content-addressed upload and download,
thumbnails, and a backfill for libraries that predate it). That gives Lives a
real byte path and sets the tiering story: **WebDAV carries structured data;
GLANCEvault carries everything.** It makes the Pro pitch concrete for the
non-self-hosting family-history user, likely the least technical person in the
audience and the one with the most photos.

Two follow-ons for GLANCEvault Pro rather than for lifeGLANCE:

- **Quota must be sized against media, not row counts.** Memorial and family
  history are exactly where someone uploads dozens of scanned photos.
- **Quota enforcement must fail gracefully mid-upload**, not after the bytes
  have been pushed.

**Milestone fields that artifacts will want.** An "include in resume" boolean,
a private / family-only / public visibility tier, a headline-vs-detail
distinction. Do not add these speculatively, but keep the milestone model open
to attribute extension. (Unknown fields already survive the file-tier merge,
which keeps whole records.)

**Chapter semantics in exports.** The Chapter visibility model
(`defaultMemberVisibility` and the cascade in `src/utils/visibility.js`) was
designed for the timeline view. Resume exports may suppress whole Chapters;
memorial exports may feature some. Confirm the model extends to per-export
overrides, or note what would need to change.

**Two visibility axes, kept separate.** Chapter `defaultMemberVisibility` with
its cascade (a timeline display concern) and the proposed private /
family-only / public tier (an export audience concern) look similar and are
not. If they share a field, the cascade will silently rewrite export audience,
or an export preset will silently hide milestones from the timeline. Keep them
as distinct fields with distinct names.

### Use cases as test cases

Run each artifact use case against the schema and ask "what's missing or hard?"

- **Memorial.** Photos, deathDate, family relationships, featured Chapters,
  suppressed private milestones.
- **Anniversary gift.** Subset export (the relationship Chapter), the partner
  Life's data, shared milestones, ideally compare view embedded.
- **Family history.** Multiple Lives with structured relationships, photos and
  attachments per Life, merged contributions from family members (export/import
  with Life matching covers this).
- **College application appendix.** Subset export, academic Chapter visibility,
  clean aesthetic preset.
- **Interactive resume.** Visibility tiers on milestones, professional summary
  on Life, clean preset, ability to host or embed.
- **Memoir support.** Rich-text descriptions, research notes per milestone,
  possibly a draft/outline export.
- **Legacy planning.** Full data export in a format that survives the product,
  ideally a "playback" mode for descendants.

The point isn't to build all of this in v5.0. The point is that v5.0's schema
should not foreclose any of it.

---

## Build phases

Each phase is one PR, merged and verified before the next starts.

| Phase | Ships in | Scope | Out of scope |
|---|---|---|---|
| 0 | docs | This document: reconcile, retag to v5.0.0, record decisions. | Any code. |
| 1 | 4.x | Forward-compat sync: writer stamps on both tiers, unknown file keys passed through, unknown vault row kinds ignored quietly, "newer version" notice. Records the in-record ownership model and the 60-day gate. | Any Life entity or field, filtering, migration; UI beyond the notice. |
| 2 | 5.0 | Data layer: Life record and row kind, Me marker, milestone Life set (LWW), Chapter Life, IndexedDB v7 migration into Me, Life-aware sync, undo with membership. | UI beyond what is needed to keep the app working as single-Life. |
| 3 | 5.0 | Life switcher, Life editor, per-Life `birthDate` / `deathDate`, chrome tint, breadcrumb, shared-milestone UI. | Compare view, relationships, import. |
| 4 | 5.0 | Relationship edges and the "relationship to Me" picker. | Any other relationship UI. |
| 5 | 5.0 | Export/import with merge and the Life matching flow. | Real-time collaboration. |
| 6 | 5.0 | Read-only compare view, date-aligned, `deathDate` row ends. | Age-alignment (v5.1), editing in compare. |

Cross-cutting costs every UI phase pays: 10 locales and 13 namespaces with
parity tests (`src/locales.test.js` and friends), native string catalogs where
native code changes, and CONTRIBUTING's rules (no em dashes in user-facing copy,
docs updated in the same PR, timeline checked from week to decades zoom in both
themes). CI runs lint and `npm test`.

---

## Prompt principles for Claude Code

These principles emerged from the Chapters build cycle and apply to all subsequent phase prompts:

- Reference this spec doc explicitly as source of truth; tell Code not to invent behavior not specified
- Name what's *out of scope* for each phase, not just what's in scope (Code tends to over-deliver if not fenced)
- Ask for runtime instrumentation as part of verification, not just static analysis
- Name regression risks for each phase
- Each phase = one PR; merge and verify before starting the next
- For purely structural changes (renames, refactors), require explicit migration paths and idempotency
- Surface design decisions rather than silently choosing; flag non-trivial choices in the PR description
